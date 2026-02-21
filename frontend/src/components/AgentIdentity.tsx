import React, { useEffect, useState } from "react";

interface AgentData {
  address: string; signature: string; message: string;
  timestamp: string; network: string; chainId: number;
  spendStats: { spent24h: number; dailyCap: number; perRequestCap: number; revoked: boolean };
  tokenLabel?: string;
}

const EXPLORER = "https://testnet.kitescan.ai";

const SCOPES = [
  { id: "market.create",    desc: "Deploy synthetic markets",   ok: true  },
  { id: "oracle.update",    desc: "Push price updates on-chain",ok: true  },
  { id: "pool.seed",        desc: "Bootstrap pool liquidity",   ok: true  },
  { id: "fund.withdraw",    desc: "Withdraw from treasury",     ok: false },
  { id: "contract.upgrade", desc: "Upgrade proxy contracts",    ok: false },
  { id: "admin.revoke",     desc: "Revoke agent keys",          ok: false },
];

export function AgentIdentity({ backendUrl }: { backendUrl: string }) {
  const [data,       setData]       = useState<AgentData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [showScopes, setShowScopes] = useState(false);
  const [showSig,    setShowSig]    = useState(false);

  useEffect(() => {
    fetch(`${backendUrl}/agent-identity`)
      .then((r) => r.json() as Promise<AgentData>)
      .then(setData)
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [backendUrl]);

  if (loading) return (
    <div style={{ padding: "12px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: 20, display: "flex", gap: 10, alignItems: "center", color: "var(--text-3)", fontSize: 12 }}>
      <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span> Loading agent…
    </div>
  );
  if (!data) return null;

  const pct      = Math.min(100, (data.spendStats.spent24h / data.spendStats.dailyCap) * 100);
  const isWarn   = pct > 75;
  const isRevoked = data.spendStats.revoked;
  const barColor = isRevoked ? "var(--red)" : pct > 90 ? "var(--red)" : isWarn ? "var(--gold)" : "var(--accent)";

  return (
    <div style={{
      background: "var(--surface)", border: `1px solid ${isRevoked ? "var(--red-border)" : "var(--border)"}`,
      borderRadius: "var(--radius-lg)", marginBottom: 20,
      boxShadow: isRevoked ? "0 0 20px rgba(245,59,74,0.08)" : "var(--shadow-card)",
      overflow: "hidden",
    }}>
      {/* Main row */}
      <div style={{ padding: "14px 18px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {/* Status dot + label */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: isRevoked ? "var(--red)" : "var(--accent)",
            boxShadow: isRevoked ? "0 0 8px var(--red)" : "0 0 8px var(--accent)",
            animation: isRevoked ? "none" : "glow-pulse 2s infinite",
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {isRevoked ? "Agent Revoked" : "Autonomous Agent"}
          </span>
          <span className="badge badge-accent" style={{ fontSize: 9 }}>{data.network}</span>
        </div>

        {/* Wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>Wallet</span>
          <a href={`${EXPLORER}/address/${data.address}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
            {data.address.slice(0,10)}…{data.address.slice(-6)}
          </a>
          <button onClick={() => void navigator.clipboard.writeText(data.address)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 13, padding: "0 2px" }} title="Copy">⎘</button>
        </div>

        {/* Spend meter */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>24h Spend</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", color: isWarn ? barColor : "var(--text-2)", fontWeight: 600 }}>
              ${data.spendStats.spent24h.toFixed(2)} / ${data.spendStats.dailyCap} ${data.tokenLabel ?? "USDT"}
            </span>
          </div>
          <div style={{ height: 5, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
          {isWarn && !isRevoked && <div style={{ fontSize: 10, color: barColor, marginTop: 3, fontWeight: 600 }}>⚠ Approaching daily cap</div>}
        </div>

        {/* Per-req cap + buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>Per-req</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", fontFamily: "JetBrains Mono, monospace" }}>${data.spendStats.perRequestCap}</div>
          </div>
          <button onClick={() => setShowScopes((s) => !s)}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)", borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "var(--text-3)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.4px" }}>
            🔑 Scopes
          </button>
          <button onClick={() => setShowSig((s) => !s)}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)", borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "var(--text-3)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.4px" }}>
            📋 Proof
          </button>
        </div>
      </div>

      {/* Revoked banner */}
      {isRevoked && (
        <div style={{ padding: "10px 18px", background: "var(--red-dim)", borderTop: "1px solid var(--red-border)", fontSize: 12, color: "var(--red)", display: "flex", gap: 10, alignItems: "center" }}>
          <span>🔒</span>
          <span><strong>Agent revoked.</strong> Set <code style={{ background: "rgba(245,59,74,0.15)", padding: "1px 6px", borderRadius: 3 }}>AGENT_REVOKED=false</code> in backend .env and restart.</span>
        </div>
      )}

      {/* Scopes panel */}
      {showScopes && (
        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-2)", animation: "slideUp 0.15s ease-out" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Authorized Key Scopes</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
            {SCOPES.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--surface)", border: `1px solid ${s.ok ? "var(--border)" : "var(--red-border)"}`, borderRadius: "var(--radius)" }}>
                <span style={{ fontSize: 12, color: s.ok ? "var(--green)" : "var(--red)", flexShrink: 0 }}>{s.ok ? "✓" : "✗"}</span>
                <code style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: s.ok ? "var(--text-2)" : "var(--text-3)" }}>{s.id}</code>
                <span style={{ fontSize: 10, color: "var(--text-4)" }}>— {s.desc}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)", padding: "8px 12px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "var(--radius)" }}>
            🔐 Fund withdrawal and contract upgrades require a separate privileged key not held by the agent.
          </div>
        </div>
      )}

      {/* Signature proof */}
      {showSig && (
        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-2)", animation: "slideUp 0.15s ease-out" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Cryptographic Proof of Identity</div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 11, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
            <div style={{ color: "var(--text-3)", marginBottom: 4 }}>// Message</div>
            <div style={{ color: "var(--text-2)", marginBottom: 10 }}>{data.message}</div>
            <div style={{ color: "var(--text-3)", marginBottom: 4 }}>// Signature</div>
            <div style={{ color: "var(--accent)" }}>{data.signature}</div>
          </div>
        </div>
      )}
    </div>
  );
}
