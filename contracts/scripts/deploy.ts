/**
 * Hardhat deploy script — Oracle Synthetic Protocol
 *
 * Deploys:
 *   1. MockOracle       (initial price: $1000, 8 decimals)
 *   2. SyntheticToken   (name + symbol from args or defaults)
 *   3. OracleReader     (reads from MockOracle or real feed)
 *   4. SyntheticVault   (100% collateral ratio)
 *
 * Then:
 *   - Transfers SyntheticToken ownership → Vault
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network kiteTestnet
 *
 * Env (backend/.env):
 *   PRIVATE_KEY, RPC_URL, CHAIN_ID, USDC_ADDRESS,
 *   SWITCHBOARD_FEED_ADDRESS (optional — omit to use MockOracle)
 */

import hre, { ethers } from "hardhat";
import dotenv from "dotenv";
import path  from "path";
import fs    from "fs";

dotenv.config({ path: path.resolve(__dirname, "../../backend/.env") });

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deployer:", deployerAddress);
  console.log("Network :", hre.network.name);

  const usdcAddress       = process.env.USDC_ADDRESS || "";
  const switchboardFeed   = process.env.SWITCHBOARD_FEED_ADDRESS || "";
  const assetName         = process.env.ASSET_NAME   || "Synthetic MOTO";
  const assetSymbol       = process.env.ASSET_SYMBOL || "sMOTO";

  if (!usdcAddress) throw new Error("USDC_ADDRESS not set in backend/.env");

  // ── 1. Oracle ──────────────────────────────────────────────────────────────
  let oracleAddress: string;
  if (switchboardFeed) {
    console.log("Using real Switchboard feed:", switchboardFeed);
    oracleAddress = switchboardFeed;
  } else {
    console.log("Deploying MockOracle ($1000 initial price) ...");
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const mock = await MockOracle.deploy(
      1000n * 10n ** 8n, // $1000 with 8 decimals
      8,
      deployerAddress
    );
    await mock.waitForDeployment();
    oracleAddress = await mock.getAddress();
    console.log("MockOracle deployed:", oracleAddress);
  }

  // ── 2. SyntheticToken ──────────────────────────────────────────────────────
  console.log(`Deploying SyntheticToken (${assetName} / ${assetSymbol}) ...`);
  const SyntheticToken = await ethers.getContractFactory("SyntheticToken");
  const token = await SyntheticToken.deploy(assetName, assetSymbol, deployerAddress);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("SyntheticToken deployed:", tokenAddress);

  // ── 3. OracleReader ────────────────────────────────────────────────────────
  console.log("Deploying OracleReader ...");
  const OracleReader = await ethers.getContractFactory("OracleReader");
  const oracle = await OracleReader.deploy(oracleAddress);
  await oracle.waitForDeployment();
  const oracleReaderAddress = await oracle.getAddress();
  console.log("OracleReader deployed:", oracleReaderAddress);

  // ── 4. SyntheticVault ─────────────────────────────────────────────────────
  console.log("Deploying SyntheticVault ...");
  const SyntheticVault = await ethers.getContractFactory("SyntheticVault");
  const vault = await SyntheticVault.deploy(
    tokenAddress,
    oracleReaderAddress,
    usdcAddress,
    10n ** 18n // 100% collateral ratio
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("SyntheticVault deployed:", vaultAddress);

  // ── 5. Transfer SyntheticToken ownership → Vault ──────────────────────────
  console.log("Transferring SyntheticToken ownership to Vault ...");
  const tx = await token.transferOwnership(vaultAddress);
  await tx.wait();
  console.log("Ownership transferred.");

  // ── 6. Write addresses ────────────────────────────────────────────────────
  const addresses = {
    network:        hre.network.name,
    deployer:       deployerAddress,
    mockOracle:     switchboardFeed ? null : oracleAddress,
    syntheticToken: tokenAddress,
    oracleReader:   oracleReaderAddress,
    syntheticVault: vaultAddress,
    usdc:           usdcAddress,
    assetName,
    assetSymbol,
    deployedAt:     new Date().toISOString(),
  };

  const outPath = path.resolve(__dirname, "../../backend/deployed.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\nDeployed addresses saved to backend/deployed.json");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
