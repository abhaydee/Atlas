/**
 * AgentIdentity — displays the autonomous agent's verifiable on-chain identity,
 * spending limits, key scopes, and security status.
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

// Key scope definitions (what the agent is authorized to do)
const KEY_SCOPES = [
  { label: "market.create",   desc: "Deploy new synthetic markets",        allowed: true  },
  { label: "oracle.update",   desc: "Push price updates on-chain",         allowed: true  },
  { label: "pool.seed",       desc: "Bootstrap initial pool liquidity",     allowed: true  },
  { label: "fund.withdraw",   desc: "Withdraw from treasury",               allowed: false },
  { label: "contract.upgrade",desc: "Upgrade proxy contracts",              allowed: false },
  { label: "admin.revoke",    desc: "Revoke other agent keys",              allowed: false },
];

export function AgentIdentity({ backendUrl }: { backendUrl: string }) {
  const [identity, setIdentity] = useState<AgentIdentityData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showScopes, setShowScopes] = useState(false);

  useEffect(() => {
    fetch(`${backendUrl}/agent-identity`)
      .then((r) => r.json() as Promise<AgentIdentityData>)
      .then(setIdentity)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [backendUrl]);

  if (loading) {
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span>
          Loading agent identity…
        </div>
      </div>
    );
  }
  if (error || !identity) return null;

  const addrShort = `${identity.address.slice(0, 10)}…${identity.address.slice(-6)}`;
  const spent     = identity.spendStats.spent24h.toFixed(2);
  const cap       = identity.spendStats.dailyCap.toFixed(0);
  const perReq    = identity.spendStats.perRequestCap.toFixed(0);
  const pct       = Math.min(100, (identity.spendStats.spent24h / identity.spendStats.dailyCap) * 100);
  const isWarning = pct > 80;
  const isRevoked = identity.spendStats.revoked;

  return (
    <div style={card}>
      {/* ── Header row ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={agentAvatar}>
            {isRevoked ? "🔒" : "🤖"}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Autonomous Agent</span>
              {!isRevoked && <span style={liveDot} />}
              {isRevoked && <span style={revokedDot} />}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              x402 Payments · Pyth Oracle · Kite Testnet
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={networkBadge}>{identity.network}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
            #{identity.chainId}
          </span>
        </div>
      </div>

      {/* ── Revoked Warning ── */}
      {isRevoked && (
        <div style={revokedBanner}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Agent Revoked</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              All autonomous actions are disabled. Set <code style={{ background: "rgba(184,50,50,0.15)", padding: "1px 5px", borderRadius: 3 }}>AGENT_REVOKED=false</code> in backend .env to re-enable.
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* Wallet address */}
        <div style={infoBox}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
            Agent Wallet
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <a
              href={`${KITE_EXPLORER}/address/${identity.address}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
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
        </div>

        {/* Per-request cap */}
        <div style={infoBox}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
            Per-Request Cap
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            ${perReq} <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>USDT max</span>
          </div>
        </div>
      </div>

      {/* ── Spend bar ── */}
      <div style={infoBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              24h Spend Limit
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
              Resets daily at UTC midnight
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: isWarning ? "var(--red)" : "var(--text)" }}>
              ${spent}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>of ${cap} USDT</div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={barTrack}>
          <div style={{
            width:      `${pct}%`,
            background: pct > 90 ? "var(--red)" : pct > 70 ? "var(--accent)" : "var(--green)",
            height:     "100%",
            transition: "width 0.4s ease",
            borderRadius: 4,
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}>
          <span>{pct.toFixed(0)}% used</span>
          <span>${(identity.spendStats.dailyCap - identity.spendStats.spent24h).toFixed(2)} remaining</span>
        </div>
        {isWarning && !isRevoked && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)", fontWeight: 600 }}>
            ⚠ Approaching daily cap — new market creation may be blocked.
          </div>
        )}
      </div>

      {/* ── Footer actions ── */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={() => setShowScopes((s) => !s)}
          style={pillBtn}
        >
          🔑 Key Scopes {showScopes ? "↑" : "↓"}
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          style={pillBtn}
        >
          📋 Signature Proof {expanded ? "↑" : "↓"}
        </button>
      </div>

      {/* ── Key Scopes ── */}
      {showScopes && (
        <div style={{ marginTop: 12, animation: "slideIn 0.15s ease-out" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            Authorized Key Scopes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {KEY_SCOPES.map((scope) => (
              <div key={scope.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: scope.allowed ? "var(--green)" : "var(--red)", flexShrink: 0 }}>
                  {scope.allowed ? "✓" : "✗"}
                </span>
                <code style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)", background: "var(--surface-2)", padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border)" }}>
                  {scope.label}
                </code>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{scope.desc}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", background: "var(--accent-light)", border: "1px solid var(--accent)", borderRadius: 6, padding: "7px 10px" }}>
            🔑 Key is scoped to minimal permissions. Fund withdrawal and contract upgrades require a separate privileged key not held by the agent.
          </div>
        </div>
      )}

      {/* ── Signature proof ── */}
      {expanded && (
        <div style={{ marginTop: 12, background: "var(--surface-2)", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all", color: "var(--muted)", animation: "slideIn 0.15s ease-out" }}>
          <div style={{ marginBottom: 4, color: "var(--text-2)", fontWeight: 600, fontFamily: "inherit" }}>Message</div>
          <div style={{ marginBottom: 10, lineHeight: 1.5 }}>{identity.message}</div>
          <div style={{ marginBottom: 4, color: "var(--text-2)", fontWeight: 600, fontFamily: "inherit" }}>Signature</div>
          <div style={{ color: "var(--green)", lineHeight: 1.5 }}>{identity.signature}</div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding:      "16px 20px",
  marginBottom: 20,
  boxShadow:    "var(--shadow-sm)",
};

const agentAvatar: React.CSSProperties = {
  width:          40,
  height:         40,
  borderRadius:   "50%",
  background:     "var(--surface-2)",
  border:         "1px solid var(--border)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  fontSize:       20,
  flexShrink:     0,
};

const liveDot: React.CSSProperties = {
  width:        8,
  height:       8,
  borderRadius: "50%",
  background:   "var(--green)",
  boxShadow:    "0 0 6px var(--green)",
  animation:    "pulse 2s infinite",
  display:      "inline-block",
};

const revokedDot: React.CSSProperties = {
  width:        8,
  height:       8,
  borderRadius: "50%",
  background:   "var(--red)",
  display:      "inline-block",
};

const revokedBanner: React.CSSProperties = {
  display:      "flex",
  gap:          10,
  alignItems:   "flex-start",
  background:   "var(--red-light)",
  border:       "1px solid var(--red)",
  borderRadius: "var(--radius)",
  padding:      "10px 14px",
  marginBottom: 12,
  color:        "var(--red)",
};

const networkBadge: React.CSSProperties = {
  fontSize:     10,
  padding:      "3px 9px",
  background:   "var(--accent-light)",
  color:        "var(--accent)",
  borderRadius: 20,
  fontWeight:   700,
  border:       "1px solid var(--accent)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.4px",
};

const infoBox: React.CSSProperties = {
  background:   "var(--surface-2)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "10px 14px",
};

const barTrack: React.CSSProperties = {
  background:   "var(--border)",
  borderRadius: 4,
  height:       6,
  overflow:     "hidden",
};

const copyBtn: React.CSSProperties = {
  background: "none",
  border:     "none",
  cursor:     "pointer",
  color:      "var(--muted)",
  padding:    "0 4px",
  fontSize:   14,
  lineHeight: 1,
};

const pillBtn: React.CSSProperties = {
  background:   "var(--surface-2)",
  border:       "1px solid var(--border)",
  borderRadius: 20,
  padding:      "5px 12px",
  fontSize:     11,
  fontWeight:   600,
  color:        "var(--text-2)",
  cursor:       "pointer",
};
