/**
 * Autonomous Pool Agent
 *
 * Monitors the AMM pool, detects price imbalances, and autonomously
 * executes rebalancing swaps and liquidity management — all payments
 * go through Kite Agent Passport (MCP → x402 → Kite L1).
 *
 * Control flow:
 *   1. Poll /pool/status every N seconds (free)
 *   2. Use OpenRouter AI to decide: swap, add-liquidity, hold
 *   3. Run proposed action through SpendingGuard
 *   4. If approved, call pool via x402 → Kite MCP payment
 *   5. Log result with full payment details
 *
 * Run: npm run pool:agent
 */

import OpenAI from "openai";
import chalk from "chalk";
import { KiteMCPClient } from "../mcp-client.js";
import { X402Handler } from "../x402-handler.js";
import { SpendingGuard, DEFAULT_LIMITS, SpendingLimits } from "./spending-guard.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import dotenv from "dotenv";
dotenv.config();

const POOL_URL = `http://localhost:${process.env.POOL_SERVER_PORT || "8402"}`;
const DEMO_MODE = process.argv.includes("--demo"); // run without Kite MCP

interface PoolStatus {
  reserveA: number;
  reserveB: number;
  totalLiquidity: number;
  price: number;
  tokenA: string;
  tokenB: string;
  swapCount: number;
  feeRate: number;
}

interface AgentDecision {
  action: "swap" | "add_liquidity" | "remove_liquidity" | "hold";
  tokenIn?: "A" | "B";
  amountIn?: number;
  amountA?: number;
  amountB?: number;
  lpTokens?: number;
  reason: string;
  urgency: "low" | "medium" | "high";
}

const DECISION_PROMPT = `You are an autonomous AMM pool manager for a Uniswap v2-style constant-product pool on Kite L1 Testnet.

Your goal: keep the pool balanced around the target price and maintain healthy liquidity.

Pool tokens: TOKEN_A (KITE) / TOKEN_B (USDT)
Target price: {TARGET_PRICE} USDT per KITE

Current state:
{POOL_STATE}

Spending limits:
{LIMITS}

Decide what to do. Respond with a JSON object:
{
  "action": "swap" | "add_liquidity" | "remove_liquidity" | "hold",
  "tokenIn": "A" | "B",        // required if action=swap
  "amountIn": <number>,        // required if action=swap
  "amountA": <number>,         // required if action=add_liquidity
  "amountB": <number>,         // required if action=add_liquidity
  "lpTokens": <number>,        // required if action=remove_liquidity
  "reason": "<explanation>",
  "urgency": "low" | "medium" | "high"
}

Rules:
- If price > target * (1 + deviation): sell TOKEN_A (swap A→B)
- If price < target * (1 - deviation): buy TOKEN_A (swap B→A)
- If total liquidity is very low (< 1000): add liquidity
- Keep swaps under maxAmountPerTx
- Prefer smaller, frequent swaps over large single ones
- If within 1% of target: hold
- amountIn must not cause price impact > maxPriceImpact`;

export class PoolAgent {
  private mcpClient: KiteMCPClient;
  private x402Handler: X402Handler;
  private spendingGuard: SpendingGuard;
  private openai: OpenAI;
  private running = false;
  private cycleCount = 0;
  private lastPoolStatus: PoolStatus | null = null;

  constructor(limitOverrides: Partial<SpendingLimits> = {}) {
    this.mcpClient = new KiteMCPClient();
    this.x402Handler = new X402Handler(this.mcpClient);
    this.spendingGuard = new SpendingGuard(limitOverrides);
    this.openai = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/kite-ai-trade-agent",
        "X-Title": "Kite Pool Agent",
      },
    });
  }

  async start(): Promise<void> {
    console.log(chalk.cyan(`
╔══════════════════════════════════════════════════╗
║  Kite Autonomous Pool Agent                     ║
║  Target: ${DEFAULT_LIMITS.targetPrice.toFixed(2)} KITE/USDT                       ║
║  Budget: ${this.spendingGuard.getLimits().sessionBudget} tokens / session             ║
║  Mode: ${DEMO_MODE ? "DEMO (no Kite MCP)" : "LIVE (Kite MCP)"}                     ║
╚══════════════════════════════════════════════════╝
`));

    // Connect to Kite MCP
    if (!DEMO_MODE) {
      log.info("Connecting to Kite MCP...");
      try {
        await this.mcpClient.connect();
        const payer = await this.mcpClient.getPayerAddress();
        log.success(`Wallet: ${payer.payer_addr}`);
      } catch (err) {
        log.error(`MCP connection failed: ${err}`);
        log.warn("Starting in demo mode (payments simulated)...");
      }
    }

    // Verify pool server is reachable
    await this.waitForPool();

    this.running = true;
    log.agent("Pool agent started. Press Ctrl+C to stop.");

    const intervalMs = this.spendingGuard.getLimits().rebalanceIntervalMs;
    log.info(`Polling every ${intervalMs / 1000}s`);

    while (this.running) {
      await this.runCycle();
      await sleep(intervalMs);
    }
  }

  stop(): void {
    this.running = false;
    log.info("Pool agent stopping...");
  }

  async runCycle(): Promise<void> {
    this.cycleCount++;
    log.debug(`--- Cycle ${this.cycleCount} ---`);

    // 1. Fetch pool state (free)
    const status = await this.fetchPoolStatus();
    if (!status) {
      log.warn("Could not fetch pool status, skipping cycle");
      return;
    }
    this.lastPoolStatus = status;

    const limits = this.spendingGuard.getLimits();
    const priceDev = Math.abs(status.price - limits.targetPrice) / limits.targetPrice;

    log.info(
      chalk.white(
        `Cycle ${this.cycleCount} | Price: ${status.price.toFixed(6)} | ` +
        `Dev: ${(priceDev * 100).toFixed(2)}% | ` +
        `Reserves: ${status.reserveA.toFixed(2)}A / ${status.reserveB.toFixed(2)}B`
      )
    );

    // 2. Skip if within trigger threshold
    if (
      priceDev < limits.rebalanceTriggerDeviation &&
      status.totalLiquidity >= limits.minReserveA
    ) {
      log.debug("Price within range, holding.");
      return;
    }

    if (!this.spendingGuard.hasRemainingBudget()) {
      log.warn("Session budget exhausted — agent holding.");
      return;
    }

    // 3. Ask AI for decision
    const decision = await this.getDecision(status);
    if (!decision || decision.action === "hold") {
      log.debug(`AI decision: hold — ${decision?.reason || "no reason"}`);
      return;
    }

    log.agent(`Decision: ${decision.action} | ${decision.reason} [${decision.urgency}]`);

    // 4. Run through spending guard
    if (decision.action === "swap" && decision.tokenIn && decision.amountIn) {
      await this.executeSwap(decision, status);
    } else if (decision.action === "add_liquidity" && decision.amountA && decision.amountB) {
      await this.executeAddLiquidity(decision);
    } else if (decision.action === "remove_liquidity" && decision.lpTokens) {
      await this.executeRemoveLiquidity(decision);
    }
  }

  getStats() {
    return {
      cycleCount: this.cycleCount,
      lastPoolStatus: this.lastPoolStatus,
      spending: this.spendingGuard.getStats(),
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async executeSwap(decision: AgentDecision, poolStatus: PoolStatus): Promise<void> {
    const { tokenIn, amountIn } = decision;
    if (!tokenIn || !amountIn) return;

    // Preview the swap to get impact
    const preview = await this.previewSwap(tokenIn, amountIn);
    if (!preview) {
      log.warn("Could not preview swap, skipping");
      return;
    }

    // Spending guard check
    const guard = this.spendingGuard.checkSwap({
      amount: amountIn,
      priceImpact: preview.priceImpact,
      reserveAAfter: preview.newReserveA,
      reserveBAfter: preview.newReserveB,
    });

    if (!guard.allowed) {
      log.warn(`[Guard BLOCKED] ${guard.reason}`);
      return;
    }
    if (guard.warning) {
      log.warn(`[Guard WARNING] ${guard.warning}`);
    }

    // Execute via x402
    log.payment(
      `Executing swap: ${amountIn.toFixed(4)} ${tokenIn === "A" ? poolStatus.tokenA : poolStatus.tokenB}` +
      ` → ~${preview.amountOut.toFixed(4)} ${tokenIn === "A" ? poolStatus.tokenB : poolStatus.tokenA}` +
      ` (impact: ${(preview.priceImpact * 100).toFixed(2)}%)`
    );

    const result = await this.callPool("/pool/swap", "swap", {
      tokenIn,
      amountIn,
    });

    if (result.success) {
      this.spendingGuard.recordTx(amountIn);
      log.success(
        `Swap done: ${amountIn.toFixed(4)} → ${(result.data as { amountOut: number }).amountOut?.toFixed(4) ?? "?"} | ` +
        `New price: ${(result.data as { newPrice: number }).newPrice?.toFixed(6) ?? "?"}`
      );
    } else {
      log.error(`Swap failed: ${result.error}`);
    }
  }

  private async executeAddLiquidity(decision: AgentDecision): Promise<void> {
    const { amountA, amountB } = decision;
    if (!amountA || !amountB) return;

    const guard = this.spendingGuard.checkSwap({
      amount: amountA + amountB,
      priceImpact: 0,
      reserveAAfter: (this.lastPoolStatus?.reserveA ?? 0) + amountA,
      reserveBAfter: (this.lastPoolStatus?.reserveB ?? 0) + amountB,
    });

    if (!guard.allowed) {
      log.warn(`[Guard BLOCKED] ${guard.reason}`);
      return;
    }

    log.payment(`Adding liquidity: ${amountA.toFixed(4)} A + ${amountB.toFixed(4)} B`);

    const result = await this.callPool("/pool/add-liquidity", "addLiquidity", {
      amountA,
      amountB,
    });

    if (result.success) {
      this.spendingGuard.recordTx(amountA + amountB);
      log.success(`Liquidity added: minted ${(result.data as { lpTokensMinted: number }).lpTokensMinted?.toFixed(4) ?? "?"} LP tokens`);
    } else {
      log.error(`Add liquidity failed: ${result.error}`);
    }
  }

  private async executeRemoveLiquidity(decision: AgentDecision): Promise<void> {
    const { lpTokens } = decision;
    if (!lpTokens) return;

    log.payment(`Removing liquidity: ${lpTokens.toFixed(4)} LP tokens`);

    const result = await this.callPool("/pool/remove-liquidity", "removeLiquidity", {
      lpTokens,
    });

    if (result.success) {
      log.success(
        `Liquidity removed: ` +
        `${(result.data as { amountAReturned: number }).amountAReturned?.toFixed(4) ?? "?"} A + ` +
        `${(result.data as { amountBReturned: number }).amountBReturned?.toFixed(4) ?? "?"} B`
      );
    } else {
      log.error(`Remove liquidity failed: ${result.error}`);
    }
  }

  private async callPool(
    path: string,
    _operation: string,
    body: Record<string, unknown>
  ) {
    const url = `${POOL_URL}${path}`;
    return this.x402Handler.callService(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async previewSwap(
    tokenIn: "A" | "B",
    amountIn: number
  ): Promise<{ amountOut: number; priceImpact: number; newReserveA: number; newReserveB: number; newPrice: number } | null> {
    try {
      const res = await fetch(
        `${POOL_URL}/pool/preview-swap?tokenIn=${tokenIn}&amountIn=${amountIn}`
      );
      if (res.ok) return res.json() as Promise<{ amountOut: number; priceImpact: number; newReserveA: number; newReserveB: number; newPrice: number }>;
    } catch {
      // ignore
    }
    return null;
  }

  private async fetchPoolStatus(): Promise<PoolStatus | null> {
    try {
      const res = await fetch(`${POOL_URL}/pool/status`);
      if (res.ok) return res.json() as Promise<PoolStatus>;
    } catch {
      // ignore
    }
    return null;
  }

  private async getDecision(status: PoolStatus): Promise<AgentDecision | null> {
    const limits = this.spendingGuard.getLimits();
    const prompt = DECISION_PROMPT
      .replace("{TARGET_PRICE}", limits.targetPrice.toString())
      .replace("{POOL_STATE}", JSON.stringify({
        price: status.price,
        targetPrice: limits.targetPrice,
        deviation: ((status.price - limits.targetPrice) / limits.targetPrice * 100).toFixed(2) + "%",
        reserveA: status.reserveA,
        reserveB: status.reserveB,
        totalLiquidity: status.totalLiquidity,
        swapCount: status.swapCount,
      }, null, 2))
      .replace("{LIMITS}", JSON.stringify({
        maxAmountPerTx: limits.maxAmountPerTx,
        remainingBudget: this.spendingGuard.remainingBudget(),
        maxPriceImpact: limits.maxPriceImpact,
        minReserveA: limits.minReserveA,
        minReserveB: limits.minReserveB,
        rebalanceTriggerDeviation: limits.rebalanceTriggerDeviation,
      }, null, 2));

    try {
      const response = await this.openai.chat.completions.create({
        model: config.openrouter.model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Analyze the pool state and return your decision." },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      return JSON.parse(content) as AgentDecision;
    } catch (err) {
      log.error(`AI decision error: ${err}`);
      return this.fallbackDecision(status);
    }
  }

  private fallbackDecision(status: PoolStatus): AgentDecision {
    const limits = this.spendingGuard.getLimits();
    const priceDev = (status.price - limits.targetPrice) / limits.targetPrice;
    const maxSwap = Math.min(limits.maxAmountPerTx, this.spendingGuard.remainingBudget() * 0.1);

    if (status.totalLiquidity < limits.minReserveA) {
      return {
        action: "add_liquidity",
        amountA: Math.min(500, maxSwap),
        amountB: Math.min(500, maxSwap),
        reason: "Liquidity too low",
        urgency: "high",
      };
    }
    if (priceDev > limits.rebalanceTriggerDeviation) {
      return {
        action: "swap",
        tokenIn: "A",
        amountIn: Math.min(maxSwap, Math.abs(priceDev) * status.reserveA * 0.1),
        reason: `Price ${status.price.toFixed(4)} above target ${limits.targetPrice}, selling A`,
        urgency: "medium",
      };
    }
    if (priceDev < -limits.rebalanceTriggerDeviation) {
      return {
        action: "swap",
        tokenIn: "B",
        amountIn: Math.min(maxSwap, Math.abs(priceDev) * status.reserveB * 0.1),
        reason: `Price ${status.price.toFixed(4)} below target ${limits.targetPrice}, buying A`,
        urgency: "medium",
      };
    }
    return { action: "hold", reason: "Price within range", urgency: "low" };
  }

  private async waitForPool(retries = 10): Promise<void> {
    for (let i = 0; i < retries; i++) {
      const status = await this.fetchPoolStatus();
      if (status) {
        log.success(`Pool server reachable at ${POOL_URL}`);
        return;
      }
      log.warn(`Waiting for pool server... (${i + 1}/${retries})`);
      await sleep(2000);
    }
    throw new Error(`Pool server not reachable at ${POOL_URL}. Run: npm run pool:server`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Entry point ────────────────────────────────────────────────────────────

const agent = new PoolAgent();

process.on("SIGINT", () => {
  agent.stop();
  console.log("\n" + chalk.yellow("Pool agent stopped."));
  console.log(JSON.stringify(agent.getStats(), null, 2));
  process.exit(0);
});

agent.start().catch((err) => {
  log.error(`Fatal: ${err}`);
  process.exit(1);
});
