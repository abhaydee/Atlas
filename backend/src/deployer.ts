/**
 * Programmatic contract deployer.
 *
 * Deploys the full protocol stack using ethers v6 + Hardhat artifacts.
 * Called by POST /create-market in index.ts.
 *
 * Artifact path: ../contracts/artifacts/contracts/<Name>.sol/<Name>.json
 * (Run `cd contracts && npm run compile` before starting the backend.)
 */

import { ethers }           from "ethers";
import fs                   from "fs";
import path                 from "path";
import dotenv               from "dotenv";
import type { DeployedContracts } from "./store.js";
import { getWallet }        from "./provider.js";
dotenv.config();

const USDC_ADDRESS = process.env.USDC_ADDRESS || "";

// Use external Switchboard feed only if explicitly provided (not deployed on Kite today)
const SWITCHBOARD_FEED = process.env.SWITCHBOARD_FEED_ADDRESS || "";

// Amount of USDC (integer, human-readable) to seed the AMM pool on market creation.
// Deployer needs 2× this amount: one half goes to vault as collateral (mints synths),
// the other half goes directly to the pool as the USDC reserve.
// Set to 0 (default) to skip seeding — anyone can add liquidity later via the frontend.
const POOL_SEED_USDC = parseInt(process.env.POOL_SEED_USDC || "0", 10);

// Resolve artifact directory relative to this file
// __dirname = backend/src  →  ../../contracts/artifacts/contracts
const ARTIFACTS_DIR = path.resolve(__dirname, "../../contracts/artifacts/contracts");

interface HardhatArtifact {
  abi: ethers.InterfaceAbi;
  bytecode: string;
}

function loadArtifact(contractName: string, subfolder?: string): HardhatArtifact {
  const base = subfolder
    ? path.join(ARTIFACTS_DIR, subfolder, `${contractName}.sol`, `${contractName}.json`)
    : path.join(ARTIFACTS_DIR, `${contractName}.sol`, `${contractName}.json`);

  if (!fs.existsSync(base)) {
    throw new Error(
      `Artifact not found: ${base}\n` +
      `→ Run: cd contracts && npm install && npm run compile`
    );
  }
  return JSON.parse(fs.readFileSync(base, "utf8")) as HardhatArtifact;
}

export interface DeployResult {
  contracts: DeployedContracts;
  assetName: string;
  assetSymbol: string;
}

export interface DeployEvent {
  contract: "OracleAggregator" | "SyntheticToken" | "SyntheticVault" | "SynthPool";
  address:  string;
  txHash?:  string;
}

export type DeployCallback = (event: DeployEvent) => void;

export async function deployProtocol(
  assetName: string,
  assetSymbol: string,
  research?: import("./agent.js").ResearchResult,
  onDeploy?: DeployCallback
): Promise<DeployResult> {
  if (!USDC_ADDRESS) throw new Error("USDC_ADDRESS not set in backend/.env");

  const wallet = getWallet();
  const deployerAddress = wallet.address;
  console.log(`[deployer] Wallet: ${deployerAddress}`);

  // ── 1. OracleAggregator (real data from URLs) or external Switchboard feed ──
  let oracleAggregatorAddress: string;
  let mockOracleAddress: string | null = null;

  if (SWITCHBOARD_FEED) {
    console.log("[deployer] Using external Switchboard feed:", SWITCHBOARD_FEED);
    oracleAggregatorAddress = SWITCHBOARD_FEED;
  } else {
    console.log("[deployer] Deploying OracleAggregator ($1000 initial, updatable via job runner)...");
    const { abi, bytecode } = loadArtifact("OracleAggregator");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const agg = await factory.deploy(
      1000n * 10n ** 8n, // $1000 × 1e8 (8 decimals)
      8,
      deployerAddress
    );
    await agg.waitForDeployment();
    oracleAggregatorAddress = await agg.getAddress();
    const aggReceipt = await agg.deploymentTransaction()?.wait();
    console.log("[deployer] OracleAggregator:", oracleAggregatorAddress);
    onDeploy?.({ contract: "OracleAggregator", address: oracleAggregatorAddress, txHash: aggReceipt?.hash });
  }

  const rawOracleAddress = oracleAggregatorAddress;

  // ── 2. SyntheticToken ──────────────────────────────────────────────────────
  console.log(`[deployer] Deploying SyntheticToken (${assetName} / ${assetSymbol})...`);
  const tokenArt = loadArtifact("SyntheticToken");
  const tokenFactory = new ethers.ContractFactory(tokenArt.abi, tokenArt.bytecode, wallet);
  const tokenContract = await tokenFactory.deploy(assetName, assetSymbol, deployerAddress);
  await tokenContract.waitForDeployment();
  const tokenAddress = await tokenContract.getAddress();
  const tokenReceipt = await tokenContract.deploymentTransaction()?.wait();
  console.log("[deployer] SyntheticToken:", tokenAddress);
  onDeploy?.({ contract: "SyntheticToken", address: tokenAddress, txHash: tokenReceipt?.hash });

  // ── 3. OracleReader ────────────────────────────────────────────────────────
  console.log("[deployer] Deploying OracleReader...");
  const oracleArt = loadArtifact("OracleReader");
  const oracleFactory = new ethers.ContractFactory(oracleArt.abi, oracleArt.bytecode, wallet);
  const oracleContract = await oracleFactory.deploy(rawOracleAddress);
  await oracleContract.waitForDeployment();
  const oracleReaderAddress = await oracleContract.getAddress();
  console.log("[deployer] OracleReader:", oracleReaderAddress);

  // ── 4. SyntheticVault ─────────────────────────────────────────────────────
  console.log("[deployer] Deploying SyntheticVault...");
  const vaultArt = loadArtifact("SyntheticVault");
  const vaultFactory = new ethers.ContractFactory(vaultArt.abi, vaultArt.bytecode, wallet);
  const vaultContract = await vaultFactory.deploy(
    tokenAddress,
    oracleReaderAddress,
    USDC_ADDRESS,
    15n * 10n ** 17n // 150% collateral ratio — overcollateralised
  );
  await vaultContract.waitForDeployment();
  const vaultAddress = await vaultContract.getAddress();
  const vaultReceipt = await vaultContract.deploymentTransaction()?.wait();
  console.log("[deployer] SyntheticVault:", vaultAddress);
  onDeploy?.({ contract: "SyntheticVault", address: vaultAddress, txHash: vaultReceipt?.hash });

  // ── 5. Transfer SyntheticToken ownership → Vault ──────────────────────────
  console.log("[deployer] Transferring SyntheticToken ownership → Vault...");
  const token = new ethers.Contract(tokenAddress, tokenArt.abi, wallet);
  const ownerTx = await token.transferOwnership(vaultAddress);
  await (ownerTx as ethers.ContractTransactionResponse).wait();
  console.log("[deployer] Ownership transferred.");

  // ── 6. SynthPool (constant-product AMM for synth/USDC — long exposure) ────
  console.log("[deployer] Deploying SynthPool...");
  const poolArt = loadArtifact("SynthPool");
  const poolFactory = new ethers.ContractFactory(poolArt.abi, poolArt.bytecode, wallet);
  const lpName   = `${assetName} LP`;
  const lpSymbol = `${assetSymbol}LP`;
  const poolContract = await poolFactory.deploy(USDC_ADDRESS, tokenAddress, lpName, lpSymbol);
  await poolContract.waitForDeployment();
  const poolAddress = await poolContract.getAddress();
  const poolReceipt = await poolContract.deploymentTransaction()?.wait();
  console.log("[deployer] SynthPool:", poolAddress);
  onDeploy?.({ contract: "SynthPool", address: poolAddress, txHash: poolReceipt?.hash });

  // ── 7. Bootstrap pool liquidity (optional, requires POOL_SEED_USDC env) ───
  if (POOL_SEED_USDC > 0) {
    await _seedPool({
      wallet,
      deployerAddress,
      vaultAddress,
      vaultAbi: vaultArt.abi,
      tokenAddress,
      tokenAbi:  tokenArt.abi,
      poolAddress,
      poolAbi:   poolArt.abi,
      usdcAddress: USDC_ADDRESS,
      seedUsdc:    POOL_SEED_USDC,
    });
  } else {
    console.log("[deployer] POOL_SEED_USDC=0 — pool deployed empty. Add liquidity via the frontend.");
  }

  // ── 8. Persist addresses to disk ──────────────────────────────────────────
  const deployed: DeployedContracts = {
    syntheticToken:   tokenAddress,
    oracleReader:     oracleReaderAddress,
    syntheticVault:   vaultAddress,
    oracleAggregator: oracleAggregatorAddress,
    mockOracle:       mockOracleAddress,
    usdc:             USDC_ADDRESS,
    synthPool:        poolAddress,
  };

  const marketEntry = {
    ...deployed,
    assetName,
    assetSymbol,
    research: research ?? null,
    deployedAt: new Date().toISOString(),
  };

  // Append to deployed-markets.json (multi-market log)
  const marketsPath = path.resolve(__dirname, "../deployed-markets.json");
  let allMarkets: typeof marketEntry[] = [];
  if (fs.existsSync(marketsPath)) {
    try { allMarkets = JSON.parse(fs.readFileSync(marketsPath, "utf8")) as typeof marketEntry[]; } catch { /* ignore */ }
  }
  allMarkets.push(marketEntry);
  fs.writeFileSync(marketsPath, JSON.stringify(allMarkets, null, 2));
  console.log(`[deployer] Saved to deployed-markets.json (total: ${allMarkets.length} markets)`);

  return { contracts: deployed, assetName, assetSymbol };
}

// ── Pool bootstrap helper ─────────────────────────────────────────────────────

interface SeedPoolParams {
  wallet:          ethers.Wallet;
  deployerAddress: string;
  vaultAddress:    string;
  vaultAbi:        ethers.InterfaceAbi;
  tokenAddress:    string;
  tokenAbi:        ethers.InterfaceAbi;
  poolAddress:     string;
  poolAbi:         ethers.InterfaceAbi;
  usdcAddress:     string;
  seedUsdc:        number; // integer USDC units (e.g. 10 = 10 USDC)
}

/**
 * Seed the SynthPool with initial liquidity.
 *
 * Flow:
 *   1. Deployer approves `seedUsdc` to SyntheticVault.
 *   2. Vault mints synths at current oracle price → deployer receives synths.
 *   3. Deployer approves `seedUsdc` USDC + all minted synths to SynthPool.
 *   4. SynthPool.addLiquidity() — deployer gets LP tokens.
 *
 * Total USDC required from deployer: 2 × seedUsdc
 *   - seedUsdc → vault collateral (backing the minted synths)
 *   - seedUsdc → pool USDC reserve
 */
async function _seedPool(p: SeedPoolParams): Promise<void> {
  const MINIMAL_ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
  ] as const;

  const seedRaw = BigInt(p.seedUsdc) * 10n ** 6n; // convert integer USDC → 6-dec raw

  console.log(`[deployer] Seeding SynthPool with ${p.seedUsdc} USDC (deployer needs ${p.seedUsdc * 2} USDC total)...`);

  const usdc      = new ethers.Contract(p.usdcAddress,   MINIMAL_ERC20_ABI, p.wallet);
  const synthTkn  = new ethers.Contract(p.tokenAddress,  MINIMAL_ERC20_ABI, p.wallet);
  const vault     = new ethers.Contract(p.vaultAddress,  p.vaultAbi,        p.wallet);
  const pool      = new ethers.Contract(p.poolAddress,   p.poolAbi,         p.wallet);

  // Step 1: approve vault to pull seedUsdc USDC for collateral
  console.log("[deployer][seed] Approving USDC → Vault...");
  await (await usdc.approve(p.vaultAddress, seedRaw) as ethers.ContractTransactionResponse).wait();

  // Step 2: mint synths at current oracle price
  console.log("[deployer][seed] Minting synths via Vault...");
  await (await vault.mint(seedRaw) as ethers.ContractTransactionResponse).wait();

  const synthBal: bigint = await synthTkn.balanceOf(p.deployerAddress) as bigint;
  console.log(`[deployer][seed] Minted ${ethers.formatEther(synthBal)} synths`);

  if (synthBal === 0n) {
    console.warn("[deployer][seed] No synths minted — skipping pool seed. Check deployer USDC balance.");
    return;
  }

  // Step 3: approve USDC + synths to pool
  console.log("[deployer][seed] Approving USDC + synths → SynthPool...");
  await (await usdc.approve(p.poolAddress, seedRaw) as ethers.ContractTransactionResponse).wait();
  await (await synthTkn.approve(p.poolAddress, synthBal) as ethers.ContractTransactionResponse).wait();

  // Step 4: add initial liquidity — this sets the starting price ratio
  console.log("[deployer][seed] Adding initial liquidity to SynthPool...");
  await (await pool.addLiquidity(seedRaw, synthBal) as ethers.ContractTransactionResponse).wait();

  console.log(`[deployer][seed] SynthPool seeded. AMM price ≈ oracle price at deployment.`);
}

/** Update OracleAggregator price (oracle runner / dev use). */
export async function updateAggregatorPrice(
  aggregatorAddress: string,
  newPriceUSD: number
): Promise<void> {
  const wallet = getWallet();
  const { abi } = loadArtifact("OracleAggregator");
  const oracle = new ethers.Contract(aggregatorAddress, abi, wallet);
  const priceScaled = BigInt(Math.round(newPriceUSD * 1e8));
  const tx = await oracle.updatePrice(priceScaled);
  await (tx as ethers.ContractTransactionResponse).wait();
  console.log(`[deployer] OracleAggregator price updated to $${newPriceUSD}`);
}
