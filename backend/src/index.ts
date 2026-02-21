/**
 * Oracle Synthetic Protocol — Autonomous Agent Backend (Multi-Market)
 *
 * Routes:
 *   GET  /markets                — All live markets (dashboard)
 *   POST /create-market          — Start autonomous market creation
 *   GET  /job/:id                — Poll job status
 *   GET  /job/:id/stream         — SSE: real-time job progress
 *   GET  /agent-identity         — Agent wallet address + signature proof
 *   GET  /markets/:id/data       — Live oracle price, TVL, supply for one market
 *   GET  /markets/:id/pool       — SynthPool AMM reserves + quotes for one market
 *   POST /markets/:id/oracle     — Update oracle price from research URLs
 *   POST /markets/:id/set-price  — Dev: manual price override
 *   POST /markets/:id/delete     — Remove market from dashboard
 *   GET  /x402-status            — Payment config info
 */

import express, { Request, Response, NextFunction } from "express";
import cors    from "cors";
import dotenv  from "dotenv";
import path    from "path";
import fs      from "fs";
import { ethers } from "ethers";

import { researchAsset }                              from "./agent.js";
import { deployProtocol, updateAggregatorPrice }      from "./deployer.js";
import { runOracleUpdate }                            from "./oracle-runner.js";
import { resolveFeedEntry, getBenchmarksSymbol,
         fetchPythHistory }                           from "./pyth-provider.js";
import { addMarket, getMarket, getAllMarkets,
         removeMarket, splitFee,
         createJob, getJob, updateJobStep,
         failJob, completeJob,
         subscribeToJob, type JobRecord,
         type MarketRecord }                          from "./store.js";
import { decodePaymentHeader, settlePayment }         from "./facilitator.js";
import { getAgentIdentity, signAgentPayment }         from "./agent-signer.js";
import { assertCanSpend, recordSpend, getSpendStats } from "./spending-guard.js";
import { getProviderOrNull, getWalletOrNull }         from "./provider.js";
import { spawnAgent, getAllAgents, getAgent,
         subscribeToAgentActivity,
         type AgentRole }                             from "./agent-trader.js";

dotenv.config();

const PORT           = parseInt(process.env.PORT      || "3000", 10);
const BACKEND_URL    = process.env.BACKEND_URL        || `http://localhost:${PORT}`;
const PAYEE_ADDRESS  = process.env.PAYEE_ADDRESS      || "0x1a5de860035E2E388140345a0F15897A19A92DB8";
const TOKEN_ASSET    = "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";
const TOKEN_DECIMALS = 6;
const X402_DISABLE   = process.env.X402_DISABLE === "true";

const app = express();
app.use(cors());
app.use(express.json());

// ── ABI fragments ─────────────────────────────────────────────────────────────

const ORACLE_ABI = ["function getLatestPrice() view returns (uint256)"];
const VAULT_ABI  = [
  "function getTVL() view returns (uint256)",
  "function getExcessCollateral() view returns (uint256)",
  "function accumulatedFees() view returns (uint256)",
  "function MINT_FEE_BPS() view returns (uint256)",
];
const ERC20_ABI  = [
  "function totalSupply() view returns (uint256)",
  "function decimals()    view returns (uint8)",
];
const POOL_ABI = [
  "function getReserves() view returns (uint256 usdcReserve, uint256 synthReserve)",
  "function getPrice()    view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function quoteUsdcForSynth(uint256) view returns (uint256 synthOut, uint256 priceImpactBps)",
  "function quoteSynthForUsdc(uint256) view returns (uint256 usdcOut, uint256 priceImpactBps)",
  "function addLiquidity(uint256 usdcAmount, uint256 synthAmount) returns (uint256 lpTokens)",
];

const VAULT_MINT_ABI = [
  "function mint(uint256 usdcAmount)",
  "function syntheticToken() view returns (address)",
  "function getTVL() view returns (uint256)",
];

const FULL_ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals()         view returns (uint8)",
  "function totalSupply()      view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)",  // MockERC20 faucet (if available)
];

// ── Startup: restore markets from deployed-markets.json ───────────────────────

function loadDeployedMarkets(): void {
  const p = path.resolve(__dirname, "../deployed-markets.json");
  if (!fs.existsSync(p)) {
    // Fallback: load legacy single-market deployed.json
    loadLegacyDeployed();
    return;
  }
  try {
    const list = JSON.parse(fs.readFileSync(p, "utf8")) as Array<{
      syntheticToken?:  string;
      oracleReader?:    string;
      syntheticVault?:  string;
      oracleAggregator?: string;
      mockOracle?:      string | null;
      usdc?:            string;
      synthPool?:       string;
      assetName?:       string;
      assetSymbol?:     string;
      research?:        unknown;
      deployedAt?:      string;
    }>;

    for (const data of list) {
      const feedAddr = data.oracleAggregator ?? data.mockOracle ?? "";
      const id = data.deployedAt ?? Date.now().toString();
      addMarket({
        id,
        assetName:        data.assetName    || "Unknown",
        assetSymbol:      data.assetSymbol  || "UNK",
        assetDescription: "",
        research:         data.research ?? null,
        contracts: {
          syntheticToken:   data.syntheticToken   ?? "",
          oracleReader:     data.oracleReader     ?? "",
          syntheticVault:   data.syntheticVault   ?? "",
          oracleAggregator: feedAddr,
          mockOracle:       data.mockOracle ?? null,
          usdc:             data.usdc ?? "",
          synthPool:        data.synthPool ?? "",
        },
        feeAllocation: splitFee(0),
        createdAt:     data.deployedAt ?? new Date().toISOString(),
      });
    }
    console.log(`[startup] Restored ${list.length} market(s) from deployed-markets.json`);
  } catch (err) {
    console.warn("[startup] Could not parse deployed-markets.json:", (err as Error).message);
  }
}

function loadLegacyDeployed(): void {
  const p = path.resolve(__dirname, "../deployed.json");
  if (!fs.existsSync(p)) return;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as {
      syntheticToken?:  string;
      oracleReader?:    string;
      syntheticVault?:  string;
      oracleAggregator?: string;
      mockOracle?:      string | null;
      usdc?:            string;
      synthPool?:       string;
      assetName?:       string;
      assetSymbol?:     string;
      research?:        import("./agent.js").ResearchResult | null;
      deployedAt?:      string;
    };
    const feedAddr = data.oracleAggregator ?? data.mockOracle ?? "";
    addMarket({
      id:               data.deployedAt ?? "legacy",
      assetName:        data.assetName    || "Unknown",
      assetSymbol:      data.assetSymbol  || "UNK",
      assetDescription: "",
      research:         data.research ?? null,
      contracts: {
        syntheticToken:   data.syntheticToken   ?? "",
        oracleReader:     data.oracleReader     ?? "",
        syntheticVault:   data.syntheticVault   ?? "",
        oracleAggregator: feedAddr,
        mockOracle:       data.mockOracle ?? null,
        usdc:             data.usdc ?? "",
        synthPool:        data.synthPool ?? "",
      },
      feeAllocation: splitFee(0),
      createdAt:     data.deployedAt ?? new Date().toISOString(),
    });
    console.log(`[startup] Restored 1 market from legacy deployed.json`);
  } catch { /* ignore */ }
}

// ── Autonomous market creation pipeline ───────────────────────────────────────

async function runMarketCreationJob(
  job: JobRecord,
  opts: { assetName: string; assetSymbol: string; assetDescription: string; totalPayment: number }
): Promise<void> {
  const { assetName, assetSymbol, assetDescription, totalPayment } = opts;

  try {
    // ── Step 1: x402 Payment FIRST ────────────────────────────────────────
    updateJobStep(job, "payment", { status: "running" });
    const feeAllocation = splitFee(totalPayment);
    let paymentTxHash: string | undefined;

    if (!X402_DISABLE) {
      console.log(`[job:${job.id}] Signing x402 payment (${totalPayment} USDT)...`);
      assertCanSpend(totalPayment, "create-market");

      const amountRaw = BigInt(Math.round(totalPayment * 10 ** TOKEN_DECIMALS));
      const { xPaymentHeader, log: payLogBase } = await signAgentPayment({
        tokenAddress: TOKEN_ASSET,
        payTo:        PAYEE_ADDRESS,
        amountRaw,
      });

      const payload = decodePaymentHeader(xPaymentHeader);
      if (!payload) throw new Error("Failed to encode agent x402 payload");

      const settle = await settlePayment(payload, PAYEE_ADDRESS);
      if (!settle.success) throw new Error(`x402 settlement failed: ${settle.error}`);

      paymentTxHash  = settle.txHash;
      recordSpend(totalPayment, "create-market");
      job.paymentLog = { ...payLogBase, txHash: paymentTxHash, status: "success" };

      updateJobStep(job, "payment", {
        status: "success", txHash: paymentTxHash,
        detail: `${totalPayment} USDT settled on Kite Testnet`,
      });
    } else {
      updateJobStep(job, "payment", { status: "skipped", detail: "X402_DISABLE=true" });
    }

    // ── Step 2: AI Research ───────────────────────────────────────────────
    updateJobStep(job, "research", { status: "running" });
    const research = await researchAsset(assetName, assetDescription);
    updateJobStep(job, "research", {
      status: "success",
      detail: `${research.dataSources.length} source(s) → ${research.suggestedFeedName}`,
    });

    // ── Steps 3-6: Deploy contracts ───────────────────────────────────────
    updateJobStep(job, "deploy_oracle", { status: "running" });
    updateJobStep(job, "deploy_token",  { status: "running" });
    updateJobStep(job, "deploy_vault",  { status: "running" });
    updateJobStep(job, "deploy_pool",   { status: "running" });

    const { contracts } = await deployProtocol(assetName, assetSymbol, research, (event) => {
      switch (event.contract) {
        case "OracleAggregator":
          updateJobStep(job, "deploy_oracle", { status: "success", txHash: event.txHash, detail: event.address }); break;
        case "SyntheticToken":
          updateJobStep(job, "deploy_token",  { status: "success", txHash: event.txHash, detail: event.address }); break;
        case "SyntheticVault":
          updateJobStep(job, "deploy_vault",  { status: "success", txHash: event.txHash, detail: event.address }); break;
        case "SynthPool":
          updateJobStep(job, "deploy_pool",   { status: "success", txHash: event.txHash, detail: event.address }); break;
      }
    });

    // Ensure all deploy steps done
    for (const s of ["deploy_oracle", "deploy_token", "deploy_vault", "deploy_pool"] as const) {
      const step = job.steps.find((st) => st.name === s);
      if (step?.status === "running") updateJobStep(job, s, { status: "success" });
    }

    // ── Step 7: Oracle prime ──────────────────────────────────────────────
    updateJobStep(job, "oracle_update", { status: "running" });
    const hasDataSource = research.dataSources?.some(
      (s) => s.pythFeedId || (s.url && s.jsonPath)
    );
    if (contracts.oracleAggregator && hasDataSource) {
      const result = await runOracleUpdate({ aggregatorAddress: contracts.oracleAggregator, research, assetName });
      updateJobStep(job, "oracle_update", result.success
        ? { status: "success", detail: `$${result.price} from ${result.source}` }
        : { status: "skipped",  detail: result.error ?? "Update failed" }
      );
    } else {
      updateJobStep(job, "oracle_update", { status: "skipped", detail: "No data sources" });
    }

    // ── Step 8: Check pool seed readiness ─────────────────────────────────
    updateJobStep(job, "seed_pool", { status: "running" });
    if (contracts.synthPool && getWalletOrNull()) {
      updateJobStep(job, "seed_pool", {
        status: "success",
        detail:  "Pool deployed — Market Maker agent will seed it automatically once wallet is funded",
      });
    } else {
      updateJobStep(job, "seed_pool", {
        status: "skipped",
        detail: "Deployer wallet not configured (PRIVATE_KEY missing)",
      });
    }

    // ── Step 9: Spawn one market-maker + one arbitrageur agent ────────────
    updateJobStep(job, "spawn_agents", { status: "running" });
    if (getWalletOrNull()) {
      try {
        const mmAgent  = spawnAgent({ marketId: job.id, role: "market-maker",  usdcBudget: 100 });
        const arbAgent = spawnAgent({ marketId: job.id, role: "arbitrageur",   usdcBudget: 100 });
        updateJobStep(job, "spawn_agents", {
          status: "success",
          detail: `Market Maker (${mmAgent.id.slice(-6)}) + Arbitrageur (${arbAgent.id.slice(-6)}) spawned and watching`,
        });
      } catch (err) {
        updateJobStep(job, "spawn_agents", {
          status: "skipped",
          detail: `Agent spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      updateJobStep(job, "spawn_agents", {
        status: "skipped",
        detail: "Deployer wallet not configured",
      });
    }

    // ── Store & complete ──────────────────────────────────────────────────
    const market: MarketRecord = {
      id: job.id,
      assetName, assetSymbol, assetDescription,
      research, contracts, feeAllocation,
      paymentLog: job.paymentLog,
      createdAt:  new Date().toISOString(),
    };
    addMarket(market);
    completeJob(job, market);
    console.log(`[job:${job.id}] Market "${assetName}" (${assetSymbol}) created successfully.`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[job:${job.id}] Failed:`, msg);
    if (job.paymentLog) { job.paymentLog.status = "failed"; job.paymentLog.error = msg; }
    failJob(job, msg);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /markets
 * Returns all live markets for the dashboard.
 */
app.get("/markets", (_req: Request, res: Response): void => {
  const markets = getAllMarkets();
  res.json({ markets, total: markets.length });
});

/**
 * POST /create-market
 * Autonomous: no wallet required. Returns jobId immediately.
 */
app.post("/create-market", (req: Request, res: Response): void => {
  const {
    assetName        = "Synthetic Asset",
    assetSymbol      = "sSYN",
    assetDescription = "",
    totalPayment     = 10,
  } = req.body as {
    assetName?: string; assetSymbol?: string;
    assetDescription?: string; totalPayment?: number;
  };

  const paymentAmount = Number(totalPayment) || 10;

  try {
    assertCanSpend(paymentAmount, "create-market-preflight");
  } catch (err) {
    res.status(429).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const jobId = Date.now().toString();
  const job   = createJob(jobId);

  void runMarketCreationJob(job, { assetName, assetSymbol, assetDescription, totalPayment: paymentAmount });

  res.json({
    success: true,
    jobId,
    message:   "Market creation started.",
    streamUrl: `${BACKEND_URL}/job/${jobId}/stream`,
  });
});

/**
 * GET /job/:id
 */
app.get("/job/:id", (req: Request, res: Response): void => {
  const job = getJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job);
});

/**
 * GET /job/:id/stream  — SSE
 */
app.get("/job/:id/stream", (req: Request, res: Response): void => {
  const job = getJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(`data: ${JSON.stringify(job)}\n\n`);

  if (job.status !== "running") { res.end(); return; }

  const emit      = (data: string) => { try { res.write(data); } catch { /* gone */ } };
  const unsub     = subscribeToJob(job.id, emit);
  const heartbeat = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); } }, 15_000);
  req.on("close", () => { unsub(); clearInterval(heartbeat); });
});

/**
 * GET /agent-identity
 */
app.get("/agent-identity", async (_req: Request, res: Response): Promise<void> => {
  try {
    const identity   = await getAgentIdentity();
    const spendStats = getSpendStats();
    res.json({ ...identity, spendStats, network: "kite-testnet", chainId: 2368 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /markets/:id/data
 * Live oracle price, TVL, supply for a specific market.
 */
app.get("/markets/:id/data", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }

  const provider = getProviderOrNull();
  if (!provider) { res.status(503).json({ error: "RPC_URL not configured" }); return; }

  try {
    const oracle = new ethers.Contract(market.contracts.oracleReader,    ORACLE_ABI, provider);
    const vault  = new ethers.Contract(market.contracts.syntheticVault,  VAULT_ABI,  provider);
    const token  = new ethers.Contract(market.contracts.syntheticToken,  ERC20_ABI,  provider);

    const [rawPrice, tvlRaw, supplyRaw, excessRaw, feesRaw] = await Promise.all([
      oracle.getLatestPrice()        as Promise<bigint>,
      vault.getTVL()                 as Promise<bigint>,
      token.totalSupply()            as Promise<bigint>,
      vault.getExcessCollateral().catch(() => 0n) as Promise<bigint>,
      vault.accumulatedFees().catch(() => 0n)     as Promise<bigint>,
    ]);

    res.json({
      id:                market.id,
      assetName:         market.assetName,
      assetSymbol:       market.assetSymbol,
      oraclePrice:       (Number(rawPrice)   / 1e18).toFixed(6),
      tvl:               (Number(tvlRaw)     / 1e6).toFixed(6),
      totalSupply:       (Number(supplyRaw)  / 1e18).toFixed(6),
      excessCollateral:  (Number(excessRaw)  / 1e6).toFixed(6),
      accumulatedFees:   (Number(feesRaw)    / 1e6).toFixed(6),
      contracts:         market.contracts,
      research:          market.research,
      feeAllocation:     market.feeAllocation,
      paymentLog:        market.paymentLog,
      hasSynthPool:      Boolean(market.contracts.synthPool),
      updatedAt:         new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /markets/:id/pool
 * SynthPool AMM data for a specific market.
 */
app.get("/markets/:id/pool", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  const poolAddr = market.contracts.synthPool;
  if (!poolAddr) { res.status(404).json({ error: "No SynthPool for this market" }); return; }

  const provider = getProviderOrNull();
  if (!provider) { res.status(503).json({ error: "RPC_URL not configured" }); return; }

  try {
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [reserves, rawPrice, lpSupply] = await Promise.all([
      pool.getReserves()  as Promise<[bigint, bigint]>,
      pool.getPrice()     as Promise<bigint>,
      pool.totalSupply()  as Promise<bigint>,
    ]);
    const [usdcReserve, synthReserve] = reserves;
    const out: Record<string, unknown> = {
      poolAddress:  poolAddr,
      usdcReserve:  (Number(usdcReserve)  / 1e6).toFixed(6),
      synthReserve: (Number(synthReserve) / 1e18).toFixed(6),
      ammPrice:     (Number(rawPrice)     / 1e6).toFixed(6),
      lpSupply:     (Number(lpSupply)     / 1e18).toFixed(6),
      updatedAt:    new Date().toISOString(),
    };
    const quoteUsdc  = parseFloat(req.query.quoteUsdc  as string);
    const quoteSynth = parseFloat(req.query.quoteSynth as string);
    if (quoteUsdc > 0) {
      const [synthOut, impactBps] = await pool.quoteUsdcForSynth(BigInt(Math.round(quoteUsdc * 1e6))) as [bigint, bigint];
      out.quoteUsdcForSynth = { usdcIn: quoteUsdc, synthOut: (Number(synthOut)/1e18).toFixed(6), priceImpact: (Number(impactBps)/100).toFixed(2)+"%" };
    }
    if (quoteSynth > 0) {
      const [usdcOut, impactBps] = await pool.quoteSynthForUsdc(BigInt(Math.round(quoteSynth * 1e18))) as [bigint, bigint];
      out.quoteSynthForUsdc = { synthIn: quoteSynth, usdcOut: (Number(usdcOut)/1e6).toFixed(6), priceImpact: (Number(impactBps)/100).toFixed(2)+"%" };
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /markets/:id/oracle  — trigger oracle update (Pyth or URL fallback)
 */
app.post("/markets/:id/oracle", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  const research = market.research as {
    dataSources?: Array<{ pythFeedId?: string; pythSymbol?: string; type?: string; url?: string; jsonPath?: string; name?: string }>;
  } | null;
  const hasSource = research?.dataSources?.some((s) => s.pythFeedId || (s.url && s.jsonPath));
  if (!hasSource) {
    res.status(400).json({ error: "No data sources (Pyth or URL) for this market" }); return;
  }
  try {
    const result = await runOracleUpdate({
      aggregatorAddress: market.contracts.oracleAggregator,
      research: research!,
      assetName: market.assetName,
    });
    result.success
      ? res.json({ success: true, price: result.price, source: result.source })
      : res.status(502).json({ success: false, error: result.error });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /markets/:id/pool  — on-chain pool reserves, AMM price, LP supply.
 * Works without a user wallet — the backend uses its own RPC provider.
 */
app.get("/markets/:id/pool", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  if (!market.contracts.synthPool) { res.status(404).json({ error: "No pool for this market" }); return; }

  const provider = getProviderOrNull();
  if (!provider) { res.status(503).json({ error: "RPC not configured" }); return; }

  try {
    const pool = new ethers.Contract(market.contracts.synthPool, POOL_ABI, provider);
    const [[usdcRes, synthRes], rawPrice, lpSupply] = await Promise.all([
      pool.getReserves() as Promise<[bigint, bigint]>,
      pool.getPrice()    as Promise<bigint>,
      pool.totalSupply() as Promise<bigint>,
    ]);

    res.json({
      usdcReserve:  (Number(usdcRes)  / 1e6).toFixed(6),
      synthReserve: (Number(synthRes) / 1e18).toFixed(8),
      ammPrice:     (Number(rawPrice) / 1e6).toFixed(6),
      lpSupply:     (Number(lpSupply) / 1e18).toFixed(8),
      hasLiquidity: usdcRes > 0n && synthRes > 0n,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /markets/:id/seed-pool — bootstrap AMM liquidity from the deployer wallet.
 *
 * Body: { usdcAmount: number }  (human-readable, e.g. 10 = 10 USDC)
 *
 * Steps:
 *   1. Check deployer has enough USDC
 *   2. Approve USDC → vault, call vault.mint() to get synth tokens
 *   3. Approve USDC + synth → pool, call pool.addLiquidity()
 *
 * Requires oracle to be fresh (not stale) for vault.mint() to succeed.
 */
app.post("/markets/:id/seed-pool", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  if (!market.contracts.synthPool)        { res.status(404).json({ error: "No pool for this market" }); return; }
  if (!market.contracts.syntheticVault)   { res.status(404).json({ error: "No vault for this market" }); return; }

  const rawAmount = parseFloat((req.body as { usdcAmount?: string }).usdcAmount ?? "0");
  if (!rawAmount || rawAmount <= 0) {
    res.status(400).json({ error: "usdcAmount required (e.g. { usdcAmount: 10 })" }); return;
  }

  let wallet: ReturnType<typeof getWalletOrNull>;
  try { wallet = getWalletOrNull(); } catch { wallet = null; }
  if (!wallet) { res.status(503).json({ error: "Deployer wallet not configured (PRIVATE_KEY missing)" }); return; }

  const usdcAddress = market.contracts.usdc;
  const vaultAddress = market.contracts.syntheticVault;
  const poolAddress  = market.contracts.synthPool;

  try {
    const usdc  = new ethers.Contract(usdcAddress,  FULL_ERC20_ABI, wallet);
    const vault = new ethers.Contract(vaultAddress, VAULT_MINT_ABI, wallet);
    const pool  = new ethers.Contract(poolAddress,  POOL_ABI,       wallet);

    const usdcDecimals: bigint = await usdc.decimals() as bigint;
    // Split: half goes to vault (collateral → mints synth), half stays as pool USDC reserve
    const totalRaw  = BigInt(Math.round(rawAmount * 10 ** Number(usdcDecimals)));
    const vaultHalf = totalRaw / 2n;
    const poolHalf  = totalRaw - vaultHalf;

    // Check deployer USDC balance
    const balance: bigint = await usdc.balanceOf(wallet.address) as bigint;
    if (balance < totalRaw) {
      res.status(400).json({
        error: `Deployer has ${Number(balance) / 10 ** Number(usdcDecimals)} USDC, needs ${rawAmount}`,
      });
      return;
    }

    // 1. Approve vault + mint synth
    await (await usdc.approve(vaultAddress, vaultHalf) as ethers.ContractTransactionResponse).wait();
    await (await vault.mint(vaultHalf) as ethers.ContractTransactionResponse).wait();

    // Get synth token address and balance
    const synthAddress: string = await vault.syntheticToken() as string;
    const synth = new ethers.Contract(synthAddress, FULL_ERC20_ABI, wallet);
    const synthBalance: bigint = await synth.balanceOf(wallet.address) as bigint;

    // 2. Approve USDC + synth → pool, add liquidity
    await (await usdc.approve(poolAddress,  poolHalf)     as ethers.ContractTransactionResponse).wait();
    await (await synth.approve(poolAddress, synthBalance)  as ethers.ContractTransactionResponse).wait();
    const tx = await pool.addLiquidity(poolHalf, synthBalance) as ethers.ContractTransactionResponse;
    const receipt = await tx.wait();

    res.json({
      success:     true,
      usdcSeeded:  Number(poolHalf)     / 10 ** Number(usdcDecimals),
      synthSeeded: Number(synthBalance) / 1e18,
      txHash:      receipt?.hash,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /markets/:id/chart  — historical OHLC candles from Pyth Benchmarks
 *
 * Query params:
 *   resolution  — candle size: "5" (5m), "60" (1h), "D" (1 day). Default: "60"
 *   from        — unix timestamp seconds. Default: now - 7 days
 *   to          — unix timestamp seconds. Default: now
 *
 * Returns: { symbol, resolution, candles: [{time, open, high, low, close}] }
 * Returns 404 if market has no Pyth feed, 502 if Benchmarks API fails.
 */
app.get("/markets/:id/chart", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }

  const resolution = (req.query.resolution as string) || "60";
  const now        = Math.floor(Date.now() / 1000);
  const from       = parseInt(req.query.from as string) || now - 7 * 86400;
  const to         = parseInt(req.query.to   as string) || now;

  // Resolve Benchmarks symbol — try stored pythFeedId first, then asset name
  const research = market.research as {
    dataSources?: Array<{ pythFeedId?: string }>;
  } | null;
  const storedFeedId = research?.dataSources?.find((s) => s.pythFeedId)?.pythFeedId;

  let benchmarksSymbol: string | null = null;
  if (storedFeedId) {
    benchmarksSymbol = getBenchmarksSymbol(storedFeedId);
  }
  if (!benchmarksSymbol) {
    const entry = resolveFeedEntry(market.assetName);
    benchmarksSymbol = entry?.benchmarksSymbol ?? null;
  }

  if (!benchmarksSymbol) {
    res.status(404).json({ error: `No Pyth feed found for asset "${market.assetName}"` });
    return;
  }

  const data = await fetchPythHistory(benchmarksSymbol, resolution, from, to);
  if (!data) {
    res.status(502).json({ error: "Pyth Benchmarks returned no data" });
    return;
  }

  // Shape into lightweight-charts friendly format
  const candles = data.t.map((t, i) => ({
    time:  t,
    open:  data.o[i],
    high:  data.h[i],
    low:   data.l[i],
    close: data.c[i],
  }));

  res.json({ symbol: benchmarksSymbol, resolution, candles });
});

/**
 * POST /markets/:id/set-price  — dev override
 */
app.post("/markets/:id/set-price", async (req: Request, res: Response): Promise<void> => {
  const market = getMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  const { price } = req.body as { price?: number };
  if (!price || price <= 0) { res.status(400).json({ error: "price must be positive" }); return; }
  try {
    await updateAggregatorPrice(market.contracts.oracleAggregator, price);
    res.json({ success: true, newPrice: price });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /markets/:id/delete  — remove from dashboard (on-chain contracts stay)
 */
app.post("/markets/:id/delete", (req: Request, res: Response): void => {
  const removed = removeMarket(req.params.id);
  res.json({ success: removed, id: req.params.id });
});

// ── Agent API ─────────────────────────────────────────────────────────────────

/**
 * GET /agents
 * List all active autonomous agents and their states.
 */
app.get("/agents", (_req: Request, res: Response): void => {
  res.json({ agents: getAllAgents() });
});

/**
 * GET /agents/balance
 * Returns the agent wallet's USDC balance (so frontend can show funding prompt).
 */
app.get("/agents/balance", async (_req: Request, res: Response): Promise<void> => {
  const wallet = getWalletOrNull();
  if (!wallet) { res.json({ address: null, usdcBalance: "0", funded: false }); return; }

  const markets = getAllMarkets();
  const usdcAddress = markets[0]?.contracts.usdc;
  if (!usdcAddress) { res.json({ address: wallet.address, usdcBalance: "0", funded: false }); return; }

  try {
    const usdc    = new ethers.Contract(usdcAddress, ["function balanceOf(address) view returns (uint256)"], wallet);
    const raw: bigint = await usdc.balanceOf(wallet.address) as bigint;
    const human = (Number(raw) / 1e6).toFixed(4);
    res.json({ address: wallet.address, usdcBalance: human, funded: Number(raw) >= 10 * 1e6 });
  } catch (err) {
    res.json({ address: wallet.address, usdcBalance: "0", funded: false, error: (err as Error).message });
  }
});

/**
 * GET /agents/stream  — SSE
 * Real-time stream of all agent activity events.
 */
app.get("/agents/stream", (req: Request, res: Response): void => {
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  // Send current state immediately
  res.write(`data: ${JSON.stringify({ type: "init", agents: getAllAgents() })}\n\n`);

  const unsub     = subscribeToAgentActivity((event) => { try { res.write(event); } catch { /* gone */ } });
  const heartbeat = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); } }, 15_000);
  req.on("close", () => { unsub(); clearInterval(heartbeat); });
});

/**
 * POST /agents/spawn
 * Body: { marketId, role: "market-maker" | "arbitrageur", usdcBudget? }
 * Spawns a new autonomous agent for the specified market.
 */
app.post("/agents/spawn", (req: Request, res: Response): void => {
  const { marketId, role, usdcBudget } = req.body as {
    marketId?:   string;
    role?:       AgentRole;
    usdcBudget?: number;
  };

  if (!marketId || !role) {
    res.status(400).json({ error: "marketId and role are required" });
    return;
  }
  if (!["market-maker", "arbitrageur"].includes(role)) {
    res.status(400).json({ error: "role must be 'market-maker' or 'arbitrageur'" });
    return;
  }
  if (!getMarket(marketId)) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  if (!getWalletOrNull()) {
    res.status(503).json({ error: "Deployer wallet not configured (PRIVATE_KEY missing)" });
    return;
  }

  const agent = spawnAgent({ marketId, role, usdcBudget: usdcBudget ?? 50 });
  res.json({ success: true, agentId: agent.id, role: agent.role });
});

/**
 * DELETE /agents/:id
 * Stop and remove a running agent.
 */
app.delete("/agents/:id", (req: Request, res: Response): void => {
  const agent = getAgent(req.params.id);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  agent.stop();
  res.json({ success: true, id: req.params.id });
});

/**
 * GET /x402-status
 */
app.get("/x402-status", (_req: Request, res: Response): void => {
  res.json({
    mode:                        X402_DISABLE ? "disabled" : "autonomous-agent",
    createMarketRequiresPayment: !X402_DISABLE,
    payeeAddress:                 PAYEE_ADDRESS,
    tokenAsset:                   TOKEN_ASSET,
    backendUrl:                   BACKEND_URL,
  });
});

// ── Legacy compat routes (keep existing frontend working) ─────────────────────

app.get("/contracts", (_req: Request, res: Response): void => {
  const markets = getAllMarkets();
  if (!markets.length) { res.status(404).json({ error: "No markets deployed yet." }); return; }
  const m = markets[0];
  res.json({ contracts: m.contracts, assetName: m.assetName, assetSymbol: m.assetSymbol, paymentLog: m.paymentLog });
});

app.get("/market-data", async (_req: Request, res: Response): Promise<void> => {
  const markets = getAllMarkets();
  if (!markets.length) { res.status(404).json({ error: "No market deployed yet." }); return; }
  // Redirect to the first market's data endpoint
  const m = markets[0];
  const provider = getProviderOrNull();
  if (!provider) { res.status(503).json({ error: "RPC_URL not configured." }); return; }
  try {
    const oracle = new ethers.Contract(m.contracts.oracleReader,   ORACLE_ABI, provider);
    const vault  = new ethers.Contract(m.contracts.syntheticVault, VAULT_ABI,  provider);
    const token  = new ethers.Contract(m.contracts.syntheticToken, ERC20_ABI,  provider);
    const [rawPrice, tvlRaw, supplyRaw] = await Promise.all([
      oracle.getLatestPrice() as Promise<bigint>,
      vault.getTVL()          as Promise<bigint>,
      token.totalSupply()     as Promise<bigint>,
    ]);
    res.json({
      assetName: m.assetName, assetSymbol: m.assetSymbol,
      oraclePrice: (Number(rawPrice)/1e18).toFixed(6),
      tvl:         (Number(tvlRaw)/1e6).toFixed(6),
      totalSupply: (Number(supplyRaw)/1e18).toFixed(6),
      contracts: m.contracts, research: m.research, feeAllocation: m.feeAllocation,
      paymentLog: m.paymentLog, hasSynthPool: Boolean(m.contracts.synthPool),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ── Oracle scheduler (updates all live markets) ───────────────────────────────

const ORACLE_INTERVAL_MS = parseInt(process.env.ORACLE_INTERVAL_MS || "300000", 10);

function startOracleScheduler(): void {
  if (ORACLE_INTERVAL_MS <= 0) return;
  console.log(`[oracle-scheduler] Running every ${ORACLE_INTERVAL_MS / 1000}s for all markets`);
  setInterval(async () => {
    for (const market of getAllMarkets()) {
      const research = market.research as {
        dataSources?: Array<{ pythFeedId?: string; pythSymbol?: string; type?: string; url?: string; jsonPath?: string; name?: string }>;
      } | null;
      const hasSource = research?.dataSources?.some((s) => s.pythFeedId || (s.url && s.jsonPath));
      if (!market.contracts.oracleAggregator || !hasSource) continue;
      try {
        const result = await runOracleUpdate({
          aggregatorAddress: market.contracts.oracleAggregator,
          research: research!,
          assetName: market.assetName,
        });
        if (result.success) {
          console.log(`[oracle-scheduler] ${market.assetSymbol}: $${result.price} from ${result.source}`);
        }
      } catch { /* ignore per-market errors */ }
    }
  }, ORACLE_INTERVAL_MS);
}

// ── Startup ───────────────────────────────────────────────────────────────────

loadDeployedMarkets();
startOracleScheduler();

setTimeout(async () => {
  if (!getWalletOrNull()) {
    console.warn("[agent] PRIVATE_KEY not set. Open backend/.env and set PRIVATE_KEY=<your key>");
    return;
  }
  try {
    const identity = await getAgentIdentity();
    console.log(`[agent] Wallet:    ${identity.address}`);
    console.log(`[agent] Signature: ${identity.signature.slice(0, 22)}…`);
  } catch (err) {
    console.warn("[agent] Identity error:", (err as Error).message);
  }
}, 500);

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  KITE Synthetic Markets — AI Agent Backend               ║
║  http://localhost:${PORT}                                   ║
╠═══════════════════════════════════════════════════════════╣
║  GET  /markets               (all live markets)          ║
║  POST /create-market         (autonomous — no wallet)    ║
║  GET  /job/:id/stream        (SSE job progress)          ║
║  GET  /agent-identity        (wallet + signature)        ║
║  GET  /markets/:id/data      (live price, TVL, supply)   ║
║  GET  /markets/:id/pool      (AMM reserves + quotes)     ║
║  POST /markets/:id/oracle    (update oracle)             ║
║  POST /markets/:id/seed-pool (bootstrap liquidity)       ║
╠═══════════════════════════════════════════════════════════╣
║  GET  /agents                (active AI agents)          ║
║  GET  /agents/stream         (SSE agent activity)        ║
║  POST /agents/spawn          (spawn new agent)           ║
║  DELETE /agents/:id          (stop agent)                ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
