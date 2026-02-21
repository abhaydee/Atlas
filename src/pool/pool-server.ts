/**
 * Pool Server — local x402-protected HTTP service that mimics a Kite-chain AMM pool.
 *
 * Acts as a stand-in for a real on-chain contract. When contracts are deployed
 * on Kite chain, the same x402 payment flow the agent uses here applies 1:1.
 *
 * Endpoints:
 *   GET  /pool/status            → free
 *   GET  /pool/price             → free
 *   GET  /pool/preview-swap      → free (query: tokenIn, amountIn)
 *   POST /pool/swap              → x402 protected
 *   POST /pool/add-liquidity     → x402 protected
 *   POST /pool/remove-liquidity  → x402 protected
 *   POST /pool/reset             → admin only (secret header)
 */

import express, { Request, Response, NextFunction } from "express";
import { AMM } from "./amm.js";
import { log } from "../logger.js";
import dotenv from "dotenv";
dotenv.config();

const PORT = parseInt(process.env.POOL_SERVER_PORT || "8402", 10);
const POOL_WALLET = process.env.POOL_SERVICE_WALLET || "0x4A50DCA63d541372ad36E5A36F1D542d51164F19";
const TOKEN_ASSET = "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63"; // testnet USDT
const ADMIN_SECRET = process.env.POOL_ADMIN_SECRET || "kite-pool-admin";
const VERIFY_PAYMENT = process.env.POOL_VERIFY_PAYMENT === "true"; // demo: false

// x402 service fees (in testnet USDT wei)
const FEES = {
  swap: "10000000000000000",            // 0.01 USDT
  addLiquidity: "10000000000000000",    // 0.01 USDT
  removeLiquidity: "5000000000000000",  // 0.005 USDT
} as const;

const amm = new AMM();
const app = express();
app.use(express.json());

// ── Helpers ────────────────────────────────────────────────────────────────

function build402(
  operation: keyof typeof FEES,
  resource: string,
  description: string
) {
  return {
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "gokite-aa",
        network: "kite-testnet",
        maxAmountRequired: FEES[operation],
        resource,
        description,
        mimeType: "application/json",
        outputSchema: {},
        payTo: POOL_WALLET,
        maxTimeoutSeconds: 300,
        asset: TOKEN_ASSET,
        extra: null,
        merchantName: "Kite AMM Pool",
      },
    ],
    x402Version: 1,
  };
}

function validatePayment(req: Request): boolean {
  const header = req.headers["x-payment"];
  if (!header) return false;
  if (!VERIFY_PAYMENT) {
    // Demo mode: any non-empty header is accepted
    return true;
  }
  // Production: would call Kite facilitator /v2/verify here
  try {
    const decoded = Buffer.from(header as string, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return !!parsed && (!!parsed.x_payment || !!parsed.authorization);
  } catch {
    return false;
  }
}

function requirePayment(operation: keyof typeof FEES) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!validatePayment(req)) {
      const resource = `http://localhost:${PORT}${req.path}`;
      res.status(402).json(build402(operation, resource, req.path));
      return;
    }
    next();
  };
}

// ── Free endpoints ─────────────────────────────────────────────────────────

app.get("/pool/status", (_req, res) => {
  const state = amm.getState();
  res.json({
    ...state,
    price: amm.getPrice(),
    priceInverse: amm.getPriceInverse(),
    invariant: amm.getInvariant(),
    serverTime: new Date().toISOString(),
  });
});

app.get("/pool/price", (_req, res) => {
  res.json({
    price: amm.getPrice(),
    priceInverse: amm.getPriceInverse(),
    tokenA: amm.getState().tokenA,
    tokenB: amm.getState().tokenB,
    reserveA: amm.getState().reserveA,
    reserveB: amm.getState().reserveB,
  });
});

app.get("/pool/preview-swap", (req, res) => {
  const tokenIn = req.query.tokenIn as "A" | "B";
  const amountIn = parseFloat(req.query.amountIn as string);

  if (!["A", "B"].includes(tokenIn) || isNaN(amountIn) || amountIn <= 0) {
    res.status(400).json({ error: "tokenIn must be A or B, amountIn must be > 0" });
    return;
  }

  try {
    const preview = amm.previewSwap(tokenIn, amountIn);
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── x402-protected endpoints ───────────────────────────────────────────────

app.post("/pool/swap", requirePayment("swap"), (req, res) => {
  const { tokenIn, amountIn } = req.body as { tokenIn: "A" | "B"; amountIn: number };

  if (!["A", "B"].includes(tokenIn) || typeof amountIn !== "number" || amountIn <= 0) {
    res.status(400).json({ error: "tokenIn must be A or B, amountIn must be > 0" });
    return;
  }

  try {
    const result = amm.swap(tokenIn, amountIn);
    log.payment(
      `SWAP: ${amountIn.toFixed(4)} ${tokenIn === "A" ? amm.getState().tokenA : amm.getState().tokenB}` +
      ` → ${result.amountOut.toFixed(4)} ${tokenIn === "A" ? amm.getState().tokenB : amm.getState().tokenA}` +
      ` (impact: ${(result.priceImpact * 100).toFixed(2)}%)`
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/pool/add-liquidity", requirePayment("addLiquidity"), (req, res) => {
  const { amountA, amountB } = req.body as { amountA: number; amountB: number };

  if (typeof amountA !== "number" || typeof amountB !== "number" || amountA <= 0 || amountB <= 0) {
    res.status(400).json({ error: "amountA and amountB must be > 0" });
    return;
  }

  try {
    const result = amm.addLiquidity(amountA, amountB);
    log.success(
      `ADD LIQUIDITY: ${result.amountA.toFixed(4)} A + ${result.amountB.toFixed(4)} B` +
      ` → minted ${result.lpTokensMinted.toFixed(4)} LP`
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/pool/remove-liquidity", requirePayment("removeLiquidity"), (req, res) => {
  const { lpTokens } = req.body as { lpTokens: number };

  if (typeof lpTokens !== "number" || lpTokens <= 0) {
    res.status(400).json({ error: "lpTokens must be > 0" });
    return;
  }

  try {
    const result = amm.removeLiquidity(lpTokens);
    log.info(
      `REMOVE LIQUIDITY: burned ${result.lpTokensBurned.toFixed(4)} LP` +
      ` → ${result.amountAReturned.toFixed(4)} A + ${result.amountBReturned.toFixed(4)} B`
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── Admin ─────────────────────────────────────────────────────────────────

app.post("/pool/reset", (req, res) => {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { reserveA, reserveB } = req.body as { reserveA?: number; reserveB?: number };
  amm.reset(reserveA ?? 10_000, reserveB ?? 10_000);
  log.warn(`Pool reset to A=${reserveA ?? 10_000}, B=${reserveB ?? 10_000}`);
  res.json({ success: true, state: amm.getState() });
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const state = amm.getState();
  console.log(`
╔════════════════════════════════════════════════╗
║  Kite AMM Pool Server                         ║
║  http://localhost:${PORT}                       ║
╠════════════════════════════════════════════════╣
║  ${state.tokenA} / ${state.tokenB}                                   ║
║  Reserve A : ${state.reserveA.toLocaleString().padEnd(34)}║
║  Reserve B : ${state.reserveB.toLocaleString().padEnd(34)}║
║  Price     : ${amm.getPrice().toFixed(6).padEnd(34)}║
║  Verify    : ${(VERIFY_PAYMENT ? "ON (facilitator)" : "OFF (demo mode)").padEnd(34)}║
╚════════════════════════════════════════════════╝

  GET  /pool/status         → pool state (free)
  GET  /pool/price          → current price (free)
  GET  /pool/preview-swap   → quote without paying (free)
  POST /pool/swap           → x402 protected
  POST /pool/add-liquidity  → x402 protected
  POST /pool/remove-liquidity → x402 protected
`);
});
