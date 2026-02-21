/**
 * AgentIdentity — displays the autonomous agent's verifiable on-chain identity.
 */

import React, { useEffect, useState } from "react";

interface AgentIdentityData {
  address:   string;
  signature: string;
  message:   string;
  timestamp: string;
  network:   string;
  chainId:   number;
  spendStats: {
    spent24h:       number;
    dailyCap:       number;
    perRequestCap:  number;
    revoked:        boolean;
  };
}

const KITE_EXPLORER = "https://testnet.kitescan.ai";

export function AgentIdentity({ backendUrl }: { backendUrl: string }) {
  const [identity, setIdentity] = useState<AgentIdentityData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`${backendUrl}/agent-identity`)
      .then((r) => r.json() as Promise<AgentIdentityData>)
      .then(setIdentity)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [backendUrl]);

  if (loading) return <div style={card}><span style={{ color: "var(--muted)", fontSize: 13 }}>Loading agent identity…</span></div>;
  if (error || !identity) return null;

  const addrShort = `${identity.address.slice(0, 8)}…${identity.address.slice(-6)}`;
  const spent     = identity.spendStats.spent24h.toFixed(2);
  const cap       = identity.spendStats.dailyCap.toFixed(0);
  const pct       = Math.min(100, (identity.spendStats.spent24h / identity.spendStats.dailyCap) * 100);

  return (
    <div style={card}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={dot} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>Autonomous Agent</span>
        </div>
        <span style={networkBadge}>{identity.network}</span>
      </div>

      {/* Address */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Wallet</span>
        <a
          href={`${KITE_EXPLORER}/address/${identity.address}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 13, fontFamily: "monospace", color: "var(--accent)", textDecoration: "none" }}
        >
          {addrShort}
        </a>
        <button
          onClick={() => void navigator.clipboard.writeText(identity.address)}
          style={copyBtn}
          title="Copy address"
        >
          ⎘
        </button>
      </div>

      {/* Spending bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
          <span>24h spend</span>
          <span>${spent} / ${cap} USDT</span>
        </div>
        <div style={{ background: "var(--border)", borderRadius: 4, height: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, background: pct > 80 ? "var(--red)" : "var(--accent)", height: "100%", transition: "width 0.4s" }} />
        </div>
      </div>

      {/* Revocation status */}
      {identity.spendStats.revoked && (
        <div style={{ background: "#2a0f0f", border: "1px solid var(--red)", borderRadius: 4, padding: "6px 10px", fontSize: 12, color: "var(--red)", marginBottom: 8 }}>
          REVOKED — agent actions disabled. Set AGENT_REVOKED=false to re-enable.
        </div>
      )}

      {/* Expand / signature proof */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{ ...copyBtn, fontSize: 11, color: "var(--muted)", padding: "3px 8px", borderRadius: 4, background: "var(--border)" }}
      >
        {expanded ? "Hide" : "Show"} signature proof
      </button>

      {expanded && (
        <div style={{ marginTop: 10, background: "var(--bg)", borderRadius: 4, padding: "10px 12px", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all", color: "var(--muted)" }}>
          <div style={{ marginBottom: 4 }}><b style={{ color: "var(--text)" }}>Message:</b></div>
          <div style={{ marginBottom: 8 }}>{identity.message}</div>
          <div style={{ marginBottom: 4 }}><b style={{ color: "var(--text)" }}>Signature:</b></div>
          <div style={{ color: "var(--green)" }}>{identity.signature}</div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background:   "rgba(108,99,255,0.06)",
  border:       "1px solid var(--accent)",
  borderRadius: "var(--radius)",
  padding:      "14px 16px",
  marginBottom: 16,
};

const dot: React.CSSProperties = {
  width:        8,
  height:       8,
  borderRadius: "50%",
  background:   "var(--green)",
  boxShadow:    "0 0 6px var(--green)",
  animation:    "pulse 2s infinite",
};

const networkBadge: React.CSSProperties = {
  fontSize:     11,
  padding:      "2px 8px",
  background:   "rgba(108,99,255,0.2)",
  color:        "var(--accent)",
  borderRadius: 12,
  fontWeight:   600,
};

const copyBtn: React.CSSProperties = {
  background: "none",
  border:     "none",
  cursor:     "pointer",
  color:      "var(--muted)",
  padding:    "0 4px",
  fontSize:   14,
};
