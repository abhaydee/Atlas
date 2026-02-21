/**
 * OperationsTable — Lists mint, redeem, swap, and liquidity operations for the current market.
 * Persisted in localStorage per market; populated when user completes a tx from UI or chat.
 */

import React from "react";

const EXPLORER = "https://testnet.kitescan.ai";

export interface OperationEntry {
  id: string;
  type: string;
  label: string;
  amount: string;
  symbol: string;
  txHash: string;
  timestamp: string;
}

export const OPERATION_LABELS: Record<string, string> = {
  mint: "Mint",
  redeem: "Redeem",
  buy: "Buy (long)",
  sell: "Sell (exit)",
  "add-liquidity": "Add liquidity",
  "remove-liquidity": "Remove liquidity",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function OperationsTable({ operations }: { operations: OperationEntry[] }) {
  if (operations.length === 0) {
    return (
      <div style={{
        padding: "24px 28px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text-3)",
        textAlign: "center",
      }}>
        No operations yet. Mint, redeem, swap, or add liquidity — they’ll show here.
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ fontFamily: "var(--font-display)", textAlign: "left", padding: "12px 14px", fontWeight: 800, fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Time</th>
            <th style={{ fontFamily: "var(--font-display)", textAlign: "left", padding: "12px 14px", fontWeight: 800, fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Operation</th>
            <th style={{ fontFamily: "var(--font-display)", textAlign: "right", padding: "12px 14px", fontWeight: 800, fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Amount</th>
            <th style={{ fontFamily: "var(--font-display)", textAlign: "left", padding: "12px 14px", fontWeight: 800, fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tx</th>
          </tr>
        </thead>
        <tbody>
          {[...operations].reverse().map((op) => (
            <tr key={op.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "10px 14px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                {formatTime(op.timestamp)}
              </td>
              <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>
                {op.label}
              </td>
              <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text)" }}>
                {op.amount} {op.symbol}
              </td>
              <td style={{ padding: "10px 14px" }}>
                <a
                  href={`${EXPLORER}/tx/${op.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}
                >
                  {op.txHash.slice(0, 10)}… ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STORAGE_KEY = "kite-operations";

export function loadOperationsForMarket(marketId: string): OperationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, OperationEntry[]>;
    return all[marketId] ?? [];
  } catch {
    return [];
  }
}

export function saveOperationsForMarket(marketId: string, list: OperationEntry[]): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all: Record<string, OperationEntry[]> = raw ? JSON.parse(raw) : {};
    all[marketId] = list;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
