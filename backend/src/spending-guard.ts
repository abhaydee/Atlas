/**
 * Agent Spending Guard — enforces per-request spend caps and rate limits.
 *
 * Security controls:
 *   AGENT_SPEND_CAP_PER_REQUEST  — max USDT per single create-market (default: 50)
 *   AGENT_DAILY_SPEND_CAP        — max USDT per rolling 24h (default: 500)
 *   RATE_LIMIT_MAX_REQUESTS      — max requests per window (default: 10)
 *   RATE_LIMIT_WINDOW_MS         — window duration in ms (default: 60 000)
 *   AGENT_REVOKED                — set "true" to disable all agent actions
 */

import dotenv from "dotenv";
dotenv.config();

const SPEND_CAP_PER_REQUEST  = parseFloat(process.env.AGENT_SPEND_CAP_PER_REQUEST  || "50");
const DAILY_SPEND_CAP        = parseFloat(process.env.AGENT_DAILY_SPEND_CAP        || "500");
const RATE_LIMIT_MAX         = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS         || "10",  10);
const RATE_LIMIT_WINDOW_MS   = parseInt(process.env.RATE_LIMIT_WINDOW_MS            || "60000", 10);
const REVOKED                = process.env.AGENT_REVOKED === "true";

// ── In-memory counters ────────────────────────────────────────────────────────

interface SpendRecord {
  amountUSDT: number;
  timestamp:  string;
  action:     string;
}

let spendHistory: SpendRecord[] = [];
let windowRequests  = 0;
let windowStartMs   = Date.now();

// ── Helpers ───────────────────────────────────────────────────────────────────

function rollingSpend24h(): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return spendHistory
    .filter((r) => new Date(r.timestamp).getTime() > cutoff)
    .reduce((sum, r) => sum + r.amountUSDT, 0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Throw if the agent is revoked, rate limited, or exceeds spending caps.
 * Call BEFORE signing a payment.
 */
export function assertCanSpend(amountUSDT: number, action = "create-market"): void {
  if (REVOKED) {
    throw new Error("Agent is revoked. Set AGENT_REVOKED=false to re-enable.");
  }

  // Rate limit
  const now = Date.now();
  if (now - windowStartMs > RATE_LIMIT_WINDOW_MS) {
    windowRequests = 0;
    windowStartMs  = now;
  }
  windowRequests++;
  if (windowRequests > RATE_LIMIT_MAX) {
    throw new Error(
      `Rate limit exceeded: max ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s. ` +
      `Try again later.`
    );
  }

  // Per-request cap
  if (amountUSDT > SPEND_CAP_PER_REQUEST) {
    throw new Error(
      `Spend cap exceeded: requested ${amountUSDT} USDT but per-request cap is ` +
      `${SPEND_CAP_PER_REQUEST} USDT.`
    );
  }

  // Rolling 24h cap
  const used = rollingSpend24h();
  if (used + amountUSDT > DAILY_SPEND_CAP) {
    throw new Error(
      `Daily spend cap exceeded: ${used.toFixed(2)} USDT used of ` +
      `${DAILY_SPEND_CAP} USDT limit. Resets in 24h.`
    );
  }

  console.log(
    `[spending-guard] ${action}: ${amountUSDT} USDT OK ` +
    `(24h: ${(used + amountUSDT).toFixed(2)}/${DAILY_SPEND_CAP}, ` +
    `rate: ${windowRequests}/${RATE_LIMIT_MAX})`
  );
}

/**
 * Record a completed spend. Call AFTER successful facilitator settle.
 */
export function recordSpend(amountUSDT: number, action = "create-market"): void {
  spendHistory.push({ amountUSDT, timestamp: new Date().toISOString(), action });
  // Keep last 1000 records
  if (spendHistory.length > 1000) spendHistory = spendHistory.slice(-1000);
}

/** Return spending stats for the agent-identity endpoint. */
export function getSpendStats(): {
  spent24h:       number;
  dailyCap:       number;
  perRequestCap:  number;
  revoked:        boolean;
  history:        SpendRecord[];
} {
  return {
    spent24h:      rollingSpend24h(),
    dailyCap:      DAILY_SPEND_CAP,
    perRequestCap: SPEND_CAP_PER_REQUEST,
    revoked:       REVOKED,
    history:       spendHistory.slice(-20), // last 20
  };
}
