/**
 * Spending Guard — client-side guardrails for the autonomous pool agent.
 *
 * Enforced BEFORE any payment is submitted to Kite MCP.
 * Provides a layered safety net on top of the Kite Session limits.
 */

import { log } from "../logger.js";

export interface SpendingLimits {
  /** Max tokens the agent can swap in a single transaction */
  maxAmountPerTx: number;
  /** Max total tokens the agent can spend across the whole session */
  sessionBudget: number;
  /** Max price impact fraction tolerated (e.g. 0.03 = 3%) */
  maxPriceImpact: number;
  /** Pool reserve A must not fall below this after a trade */
  minReserveA: number;
  /** Pool reserve B must not fall below this after a trade */
  minReserveB: number;
  /** Pause and emit a warning if a single tx exceeds this amount */
  warnThreshold: number;
  /** Interval between autonomous rebalance checks (ms) */
  rebalanceIntervalMs: number;
  /** Don't rebalance unless price has drifted more than this fraction */
  rebalanceTriggerDeviation: number;
  /** Target price ratio (TOKEN_B per TOKEN_A). 1.0 = 1:1 peg */
  targetPrice: number;
}

export interface GuardCheckResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

export interface SpendingStats {
  sessionSpent: number;
  txCount: number;
  blockedCount: number;
  lastTxAt: string | null;
  limits: SpendingLimits;
}

export const DEFAULT_LIMITS: SpendingLimits = {
  maxAmountPerTx: 500,
  sessionBudget: 5_000,
  maxPriceImpact: 0.05,         // 5%
  minReserveA: 1_000,
  minReserveB: 1_000,
  warnThreshold: 200,
  rebalanceIntervalMs: 15_000,  // check every 15s
  rebalanceTriggerDeviation: 0.02, // rebalance if price drifts >2%
  targetPrice: 1.0,             // 1 KITE = 1 USDT
};

export class SpendingGuard {
  private limits: SpendingLimits;
  private sessionSpent = 0;
  private txCount = 0;
  private blockedCount = 0;
  private lastTxAt: string | null = null;

  constructor(limits: Partial<SpendingLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  updateLimits(updates: Partial<SpendingLimits>): void {
    this.limits = { ...this.limits, ...updates };
    log.info(`[SpendingGuard] Limits updated: ${JSON.stringify(updates)}`);
  }

  /**
   * Check whether a proposed swap/action is within allowed limits.
   * Call this BEFORE executing any trade.
   */
  checkSwap(params: {
    amount: number;
    priceImpact: number;
    reserveAAfter: number;
    reserveBAfter: number;
  }): GuardCheckResult {
    const { amount, priceImpact, reserveAAfter, reserveBAfter } = params;

    if (amount > this.limits.maxAmountPerTx) {
      this.blockedCount++;
      return {
        allowed: false,
        reason: `Amount ${amount.toFixed(2)} exceeds max per-tx limit of ${this.limits.maxAmountPerTx}`,
      };
    }

    if (this.sessionSpent + amount > this.limits.sessionBudget) {
      this.blockedCount++;
      return {
        allowed: false,
        reason: `Session budget exhausted. Spent ${this.sessionSpent.toFixed(2)}, budget ${this.limits.sessionBudget}`,
      };
    }

    if (priceImpact > this.limits.maxPriceImpact) {
      this.blockedCount++;
      return {
        allowed: false,
        reason: `Price impact ${(priceImpact * 100).toFixed(2)}% exceeds max ${(this.limits.maxPriceImpact * 100).toFixed(2)}%`,
      };
    }

    if (reserveAAfter < this.limits.minReserveA) {
      this.blockedCount++;
      return {
        allowed: false,
        reason: `Post-swap reserve A (${reserveAAfter.toFixed(2)}) would fall below minimum ${this.limits.minReserveA}`,
      };
    }

    if (reserveBAfter < this.limits.minReserveB) {
      this.blockedCount++;
      return {
        allowed: false,
        reason: `Post-swap reserve B (${reserveBAfter.toFixed(2)}) would fall below minimum ${this.limits.minReserveB}`,
      };
    }

    const warning =
      amount > this.limits.warnThreshold
        ? `Large trade: ${amount.toFixed(2)} tokens (warn threshold: ${this.limits.warnThreshold})`
        : undefined;

    return { allowed: true, warning };
  }

  /** Record a completed transaction. */
  recordTx(amount: number): void {
    this.sessionSpent += amount;
    this.txCount++;
    this.lastTxAt = new Date().toISOString();
    log.info(
      `[SpendingGuard] Tx recorded: ${amount.toFixed(2)} tokens. Session total: ${this.sessionSpent.toFixed(2)}/${this.limits.sessionBudget}`
    );
  }

  /** Whether the session budget is still available. */
  hasRemainingBudget(): boolean {
    return this.sessionSpent < this.limits.sessionBudget;
  }

  /** Remaining session budget. */
  remainingBudget(): number {
    return Math.max(0, this.limits.sessionBudget - this.sessionSpent);
  }

  getStats(): SpendingStats {
    return {
      sessionSpent: this.sessionSpent,
      txCount: this.txCount,
      blockedCount: this.blockedCount,
      lastTxAt: this.lastTxAt,
      limits: { ...this.limits },
    };
  }

  getLimits(): Readonly<SpendingLimits> {
    return { ...this.limits };
  }

  resetSession(): void {
    this.sessionSpent = 0;
    this.txCount = 0;
    this.blockedCount = 0;
    this.lastTxAt = null;
    log.info("[SpendingGuard] Session reset");
  }
}
