import React, { useEffect, useRef, useState, useCallback } from "react";

const EXPLORER = "https://testnet.kitescan.ai";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentRole   = "market-maker" | "arbitrageur";
type AgentStatus = "idle" | "running" | "stopped" | "error";
type ActivityStatus = "running" | "success" | "failed" | "info";

interface AgentState {
  id:           string;
  role:         AgentRole;
  marketId:     string;
  assetSymbol:  string;
  address:      string;
  status:       AgentStatus;
  activities:   AgentActivity[];
  createdAt:    string;
  lastActionAt?: string;
}

interface AgentActivity {
  agentId:     string;
  role:        AgentRole;
  marketId:    string;
  assetSymbol: string;
  action:      string;
  detail:      string;
  txHash?:     string;
  timestamp:   string;
  status:      ActivityStatus;
}

interface Props {
  backendUrl: string;
  marketId:   string;
  assetSymbol: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_META: Record<AgentRole, { label: string; emoji: string; color: string; border: string; bg: string }> = {
  "market-maker": {
    label:  "Market Maker",
    emoji:  "🏦",
    color:  "var(--accent)",
    border: "var(--accent-border)",
    bg:     "var(--accent-dim)",
  },
  arbitrageur: {
    label:  "Arbitrageur",
    emoji:  "⚡",
    color:  "var(--gold)",
    border: "var(--gold-border)",
    bg:     "var(--gold-dim)",
  },
};

const ACTION_META: Record<string, { icon: string; color: string }> = {
  "spawn":          { icon: "🤖", color: "var(--accent)" },
  "observe":        { icon: "👁", color: "var(--text-3)" },
  "seed-liquidity": { icon: "💧", color: "var(--accent)" },
  "mint":           { icon: "⬆", color: "var(--green)" },
  "redeem":         { icon: "⬇", color: "var(--text-2)" },
  "buy-long":       { icon: "📈", color: "var(--green)" },
  "sell-long":      { icon: "📉", color: "var(--gold)" },
  "arb-decision":   { icon: "🎯", color: "var(--gold)" },
  "add-liquidity":  { icon: "➕", color: "var(--accent)" },
  "fund-needed":    { icon: "💰", color: "var(--gold)" },
  "stop":           { icon: "🛑", color: "var(--red)" },
  "error":          { icon: "⚠",  color: "var(--red)" },
};

function statusColor(s: ActivityStatus): string {
  return s === "success" ? "var(--green)"
       : s === "failed"  ? "var(--red)"
       : s === "running" ? "var(--accent)"
       : "var(--text-3)";
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)  return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

// ── Agent badge ───────────────────────────────────────────────────────────────

function AgentBadge({ agent, onStop }: { agent: AgentState; onStop: () => void }) {
  const meta = ROLE_META[agent.role];
  const isRunning = agent.status === "running";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 12px",
      background: meta.bg, border: `1px solid ${meta.border}`,
      borderRadius: "var(--radius-lg)", flexShrink: 0,
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: isRunning ? meta.color : "var(--text-4)",
        boxShadow: isRunning ? `0 0 6px ${meta.color}` : "none",
        animation: isRunning ? "glow-pulse 2s infinite" : "none",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 13 }}>{meta.emoji}</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, lineHeight: 1.2 }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 9, color: "var(--text-4)", fontFamily: "JetBrains Mono, monospace" }}>
          {agent.id.slice(-8)} · {agent.status}
        </div>
      </div>
      {isRunning && (
        <button
          onClick={onStop}
          style={{
            marginLeft: 4, background: "none", border: "none",
            cursor: "pointer", color: "var(--text-4)", fontSize: 12,
            padding: "2px 4px", borderRadius: "var(--radius)",
          }}
          title="Stop agent"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Activity row ──────────────────────────────────────────────────────────────

function ActivityRow({ activity }: { activity: AgentActivity }) {
  const roleMeta   = ROLE_META[activity.role];
  const actionMeta = ACTION_META[activity.action] ?? { icon: "•", color: "var(--text-3)" };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 90px 1fr auto",
      gap: 8, alignItems: "start",
      padding: "7px 14px",
      borderBottom: "1px solid var(--border)",
      fontSize: 12,
      animation: "slideUp 0.15s ease-out",
    }}>
      {/* Action icon */}
      <span style={{ fontSize: 14, color: actionMeta.color, textAlign: "center", marginTop: 1 }}>
        {actionMeta.icon}
      </span>

      {/* Role tag */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "2px 7px",
        background: roleMeta.bg, border: `1px solid ${roleMeta.border}`,
        borderRadius: 20, width: "fit-content",
      }}>
        <span style={{ fontSize: 9 }}>{roleMeta.emoji}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: roleMeta.color, textTransform: "uppercase", letterSpacing: "0.4px" }}>
          {roleMeta.label.split(" ")[0]}
        </span>
      </div>

      {/* Detail */}
      <div style={{ lineHeight: 1.5 }}>
        <span style={{ color: statusColor(activity.status), fontWeight: 600 }}>
          {activity.detail}
        </span>
        {activity.txHash && (
          <a
            href={`${EXPLORER}/tx/${activity.txHash}`}
            target="_blank" rel="noopener noreferrer"
            style={{
              marginLeft: 8,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10, color: "var(--accent)", textDecoration: "none",
            }}
          >
            {activity.txHash.slice(0, 10)}… ↗
          </a>
        )}
      </div>

      {/* Timestamp */}
      <span style={{ fontSize: 10, color: "var(--text-4)", whiteSpace: "nowrap", marginTop: 2 }}>
        {relativeTime(activity.timestamp)}
      </span>
    </div>
  );
}

// ── AgentConsole ──────────────────────────────────────────────────────────────

interface BalanceInfo { address: string | null; usdcBalance: string; funded: boolean }

export function AgentConsole({ backendUrl, marketId, assetSymbol }: Props) {
  const [agents,     setAgents]     = useState<AgentState[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [spawning,   setSpawning]   = useState(false);
  const [open,       setOpen]       = useState(true);
  const [balance,    setBalance]    = useState<BalanceInfo | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const esRef   = useRef<EventSource | null>(null);

  const marketAgents = agents.filter((a) => a.marketId === marketId);
  const needsFunding = balance !== null && !balance.funded;

  // ── Fetch initial agent list + wallet balance ─────────────────────────────
  const fetchAgents = useCallback(async () => {
    try {
      const [agentsRes, balRes] = await Promise.all([
        fetch(`${backendUrl}/agents`),
        fetch(`${backendUrl}/agents/balance`),
      ]);
      const agentsData = await agentsRes.json() as { agents: AgentState[] };
      const balData    = await balRes.json() as BalanceInfo;
      setAgents(agentsData.agents ?? []);
      setBalance(balData);
    } catch { /* ignore */ }
  }, [backendUrl]);

  // ── Open SSE stream for live activity ─────────────────────────────────────
  useEffect(() => {
    fetchAgents().catch(() => {});
    // Re-check balance every 15s so banner disappears once funded
    const balInterval = setInterval(() => fetchAgents().catch(() => {}), 15_000);

    const es = new EventSource(`${backendUrl}/agents/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as AgentActivity | { type: string; agents: AgentState[] };
        if ("type" in parsed && parsed.type === "init") {
          setAgents((parsed as { type: string; agents: AgentState[] }).agents ?? []);
          return;
        }
        const activity = parsed as AgentActivity;
        if (activity.marketId !== marketId) return;

        setActivities((prev) => [activity, ...prev].slice(0, 200));
        // Update agent state
        setAgents((prev) =>
          prev.map((a) =>
            a.id === activity.agentId
              ? { ...a, status: "running", lastActionAt: activity.timestamp }
              : a
          )
        );
      } catch { /* ignore */ }
    };

    return () => { es.close(); clearInterval(balInterval); };
  }, [backendUrl, marketId, fetchAgents]);

  // Auto-scroll feed to top on new activity
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [activities]);

  // ── Spawn agent ────────────────────────────────────────────────────────────
  async function spawnNewAgent(role: AgentRole) {
    setSpawning(true);
    try {
      const res = await fetch(`${backendUrl}/agents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, role, usdcBudget: 50 }),
      });
      const data = await res.json() as { success?: boolean; agentId?: string; error?: string };
      if (!data.success) throw new Error(data.error ?? "Spawn failed");
      await fetchAgents();
    } catch { /* ignore */ }
    finally { setSpawning(false); }
  }

  // ── Stop agent ─────────────────────────────────────────────────────────────
  async function stopAgent(agentId: string) {
    await fetch(`${backendUrl}/agents/${agentId}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
  }

  const noAgents = marketAgents.length === 0;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-2)",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      marginTop: 24,
      boxShadow: "var(--shadow-card)",
    }}>
      {/* Header */}
      <div
        style={{
          padding: "13px 18px",
          display: "flex", alignItems: "center", gap: 12,
          cursor: "pointer",
          background: "var(--surface-2)",
          borderBottom: open ? "1px solid var(--border)" : "none",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: noAgents ? "var(--text-4)" : "var(--accent)",
          boxShadow: noAgents ? "none" : "0 0 8px var(--accent)",
          animation: noAgents ? "none" : "glow-pulse 2s infinite",
        }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          AI Agents
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          [ Agent-to-Agent Activity ]
        </span>
        <div style={{ flex: 1 }} />

        {/* Active agents */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {marketAgents.map((a) => (
            <AgentBadge key={a.id} agent={a} onStop={() => void stopAgent(a.id)} />
          ))}
        </div>

        <span style={{ color: "var(--text-4)", fontSize: 14, marginLeft: 4 }}>
          {open ? "▾" : "▸"}
        </span>
      </div>

      {open && (
        <>
          {/* Funding banner — shown when agent wallet has insufficient USDC */}
          {needsFunding && (
            <div style={{
              padding: "12px 18px",
              display: "flex", alignItems: "center", gap: 12,
              background: "var(--gold-dim)", borderBottom: "1px solid var(--gold-border)",
            }}>
              <span style={{ fontSize: 20 }}>💰</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>
                  Agent wallet needs USDC to activate
                </div>
                <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
                  Current balance: <strong>{balance?.usdcBalance ?? "0.00"} USDC</strong>
                  {balance?.address && (
                    <span style={{ fontFamily: "JetBrains Mono, monospace", marginLeft: 6, color: "var(--text-3)" }}>
                      ({balance.address.slice(0, 10)}…{balance.address.slice(-6)})
                    </span>
                  )}
                  {" "}— needs ≥10 USDC to seed the AMM pool
                </div>
              </div>
              <a
                href="https://faucet.gokite.ai/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "7px 14px", borderRadius: "var(--radius)",
                  background: "var(--gold)", color: "#000",
                  fontSize: 12, fontWeight: 800, textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Get USDC ↗
              </a>
            </div>
          )}

          {/* Spawn controls */}
          <div style={{
            padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}>
            <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Spawn Agent
            </span>

            <button
              disabled={spawning}
              onClick={() => void spawnNewAgent("market-maker")}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px",
                background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
                borderRadius: 20, fontSize: 11, fontWeight: 700, color: "var(--accent)",
                cursor: spawning ? "not-allowed" : "pointer", opacity: spawning ? 0.6 : 1,
              }}
            >
              🏦 Market Maker
            </button>

            <button
              disabled={spawning}
              onClick={() => void spawnNewAgent("arbitrageur")}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px",
                background: "var(--gold-dim)", border: "1px solid var(--gold-border)",
                borderRadius: 20, fontSize: 11, fontWeight: 700, color: "var(--gold)",
                cursor: spawning ? "not-allowed" : "pointer", opacity: spawning ? 0.6 : 1,
              }}
            >
              ⚡ Arbitrageur
            </button>

            <div style={{ flex: 1 }} />

            <div style={{ fontSize: 10, color: "var(--text-4)", fontStyle: "italic" }}>
              Agents use the deployer wallet — no MetaMask required
            </div>
          </div>

          {/* Activity feed */}
          <div
            ref={feedRef}
            style={{
              maxHeight: 340,
              overflowY: "auto",
              background: "var(--surface)",
            }}
          >
            {activities.length === 0 ? (
              <div style={{
                padding: "32px 18px", textAlign: "center",
                color: "var(--text-4)", fontSize: 12,
              }}>
                {noAgents
                  ? "No agents yet — spawn one above to see live agent activity"
                  : "Agents are active — activity will appear here in real-time"}
              </div>
            ) : (
              activities.map((a, i) => <ActivityRow key={`${a.agentId}-${a.timestamp}-${i}`} activity={a} />)
            )}
          </div>

          {/* Footer legend */}
          <div style={{
            padding: "8px 14px",
            display: "flex", gap: 16, flexWrap: "wrap",
            background: "var(--surface-2)", borderTop: "1px solid var(--border)",
          }}>
            {[
              { icon: "🏦", label: "Market Maker — seeds & manages AMM liquidity" },
              { icon: "⚡", label: "Arbitrageur — buys/sells to close oracle-AMM spread" },
            ].map(({ icon, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-4)" }}>
                <span>{icon}</span>
                <span>{label}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: "var(--text-4)" }}>
              Market: <span style={{ color: "var(--accent)", fontWeight: 600 }}>{assetSymbol}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
