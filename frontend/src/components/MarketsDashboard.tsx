/**
 * MarketsDashboard — grid of all live markets with live prices.
 */

import React, { useEffect, useState, useCallback } from "react";

const KITE_EXPLORER = "https://testnet.kitescan.ai";

export interface MarketSummary {
  id:           string;
  assetName:    string;
  assetSymbol:  string;
  oraclePrice?: string;
  tvl?:         string;
  totalSupply?: string;
  createdAt:    string;
  contracts: {
    syntheticToken:   string;
    syntheticVault:   string;
    oracleAggregator: string;
    synthPool:        string;
    usdc:             string;
    oracleReader:     string;
    mockOracle:       string | null;
  };
  paymentLog?: {
    amountHuman:  string;
    txHash?:      string;
    status:       string;
    action?:      string;
  };
}

interface LiveData {
  oraclePrice: string;
  tvl:         string;
  totalSupply: string;
}

// Asset icon map (emoji fallback by keyword)
function assetIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("gold")    || n.includes("xau")) return "🥇";
  if (n.includes("silver")  || n.includes("xag")) return "🥈";
  if (n.includes("bitcoin") || n.includes("btc")) return "₿";
  if (n.includes("eth"))                          return "⟠";
  if (n.includes("oil")  || n.includes("crude"))  return "🛢";
  if (n.includes("gas"))                          return "⛽";
  if (n.includes("apple")  || n.includes("aapl")) return "🍎";
  if (n.includes("tsla") || n.includes("tesla"))  return "⚡";
  if (n.includes("copper"))                        return "🔶";
  if (n.includes("ruby"))                          return "💎";
  return "◈";
}

function MarketCard({
  market,
  backendUrl,
  onSelect,
}: {
  market:     MarketSummary;
  backendUrl: string;
  onSelect:   (m: MarketSummary) => void;
}) {
  const [live,    setLive]    = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(false);

  const fetchLive = useCallback(async () => {
    try {
      const res  = await fetch(`${backendUrl}/markets/${market.id}/data`);
      if (!res.ok) return;
      const data = await res.json() as LiveData;
      setLive(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [backendUrl, market.id]);

  useEffect(() => {
    void fetchLive();
    const id = setInterval(() => void fetchLive(), 15_000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const price   = live?.oraclePrice ?? "—";
  const tvl     = live?.tvl         ?? "—";
  const supply  = live?.totalSupply ?? "—";
  const hasPool = Boolean(market.contracts.synthPool);
  const age     = formatAge(market.createdAt);
  const icon    = assetIcon(market.assetName);

  return (
    <div
      style={{
        ...cardStyle,
        borderColor: hovered ? "var(--border-hover)" : "var(--border)",
        boxShadow:   hovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform:   hovered ? "translateY(-2px)" : "none",
      }}
      onClick={() => onSelect(market)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={iconCircle}>{icon}</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.3px" }}>
              {market.assetName}
            </div>
            <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, marginTop: 1 }}>
              [ {market.assetSymbol} ]
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
          {hasPool && (
            <span style={ammBadge}>AMM Pool</span>
          )}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{age}</span>
        </div>
      </div>

      {/* Price */}
      <div style={priceBox}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>
          Oracle Price
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: loading ? "var(--muted)" : "var(--text)", letterSpacing: "-0.5px" }}>
          {loading ? (
            <span style={{ fontSize: 14, fontWeight: 400 }}>Fetching…</span>
          ) : (
            `$${parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
          )}
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>via Pyth Network</div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <StatCell label="Vault TVL"    value={loading ? "—" : `$${parseFloat(tvl).toFixed(2)}`} />
        <StatCell label="Total Supply" value={loading ? "—" : `${parseFloat(supply).toFixed(4)}`} sub={market.assetSymbol} />
      </div>

      {/* Contract chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <ContractChip label="Vault"  addr={market.contracts.syntheticVault} />
        <ContractChip label="Token"  addr={market.contracts.syntheticToken} />
        <ContractChip label="Oracle" addr={market.contracts.oracleAggregator} />
        {hasPool && <ContractChip label="Pool" addr={market.contracts.synthPool} />}
      </div>

      {/* x402 Payment proof */}
      {market.paymentLog?.txHash && (
        <div style={paymentProofRow}>
          <span style={{ fontSize: 12 }}>💳</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            x402 {market.paymentLog.action ?? "market.create"}:
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--green)" }}>
            {market.paymentLog.amountHuman}
          </span>
          <a
            href={`${KITE_EXPLORER}/tx/${market.paymentLog.txHash}`}
            target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", fontFamily: "monospace", marginLeft: "auto" }}
          >
            {market.paymentLog.txHash.slice(0, 10)}… ↗
          </a>
        </div>
      )}

      {/* CTA */}
      <div style={ctaRow}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cta)" }}>
          Trade {market.assetSymbol} →
        </span>
      </div>
    </div>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={statCell}>
      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
        {value}
        {sub && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginLeft: 3 }}>{sub}</span>}
      </div>
    </div>
  );
}

function ContractChip({ label, addr }: { label: string; addr: string }) {
  if (!addr) return null;
  return (
    <a
      href={`${KITE_EXPLORER}/address/${addr}`}
      target="_blank" rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={chipStyle}
    >
      {label}: {addr.slice(0, 6)}…{addr.slice(-4)}
    </a>
  );
}

export function MarketsDashboard({
  backendUrl,
  onSelect,
  onCreateNew,
}: {
  backendUrl:  string;
  onSelect:    (market: MarketSummary) => void;
  onCreateNew: () => void;
}) {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMarkets = useCallback(async () => {
    try {
      const res  = await fetch(`${backendUrl}/markets`);
      const data = await res.json() as { markets: MarketSummary[] };
      setMarkets(data.markets ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [backendUrl]);

  useEffect(() => {
    void fetchMarkets();
    const id = setInterval(() => void fetchMarkets(), 15_000);
    return () => clearInterval(id);
  }, [fetchMarkets]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--muted)" }}>
        <div style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 24, marginBottom: 12 }}>↻</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Loading markets…</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.4px" }}>
            Live{" "}
            <span style={{ color: "var(--accent)" }}>[</span>
            {" "}Markets{" "}
            <span style={{ color: "var(--accent)" }}>]</span>
            <span style={{
              marginLeft: 10, fontSize: 12, fontWeight: 600, padding: "2px 10px",
              background: "var(--accent-light)", color: "var(--accent)",
              borderRadius: 20, border: "1px solid var(--accent)",
            }}>
              {markets.length}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, fontWeight: 500 }}>
            Click any market to trade · Powered by Pyth oracles · All contracts on Kite Testnet
          </div>
        </div>
        <button onClick={onCreateNew} style={createBtn}>
          + Create Market
        </button>
      </div>

      {/* Grid */}
      {markets.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: "var(--text)" }}>No markets yet</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>
            Deploy the first synthetic market — the AI agent handles research, x402 payment, and contract deployment autonomously.
          </div>
          <button onClick={onCreateNew} style={createBtn}>
            Create First Market
          </button>
        </div>
      ) : (
        <div style={grid}>
          {markets.map((m) => (
            <MarketCard key={m.id} market={m} backendUrl={backendUrl} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60000);
  const h  = Math.floor(m  / 60);
  const d  = Math.floor(h  / 24);
  if (d  > 0) return `${d}d ago`;
  if (h  > 0) return `${h}h ago`;
  if (m  > 0) return `${m}m ago`;
  return "just now";
}

// ── Styles ────────────────────────────────────────────────────────────────────

const grid: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
  gap:                 20,
};

const cardStyle: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding:      "20px 22px",
  cursor:       "pointer",
  transition:   "border-color 0.18s, box-shadow 0.18s, transform 0.12s",
};

const iconCircle: React.CSSProperties = {
  width:          44,
  height:         44,
  borderRadius:   "50%",
  background:     "var(--surface-2)",
  border:         "1px solid var(--border)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  fontSize:       22,
  flexShrink:     0,
};

const priceBox: React.CSSProperties = {
  background:   "var(--surface-2)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "12px 14px",
  marginBottom: 14,
};

const statCell: React.CSSProperties = {
  flex:         1,
  background:   "var(--surface-2)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "10px 12px",
};

const ammBadge: React.CSSProperties = {
  fontSize:     10,
  fontWeight:   700,
  padding:      "2px 8px",
  background:   "var(--green-light)",
  color:        "var(--green)",
  borderRadius: 20,
  border:       "1px solid rgba(42,125,82,0.25)",
};

const paymentProofRow: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          6,
  borderTop:    "1px solid var(--border)",
  paddingTop:   10,
  marginBottom: 10,
};

const ctaRow: React.CSSProperties = {
  borderTop:  "1px solid var(--border)",
  paddingTop: 12,
  textAlign:  "right",
};

const createBtn: React.CSSProperties = {
  background:   "var(--cta)",
  color:        "#FFFFFF",
  border:       "none",
  borderRadius: "var(--radius)",
  padding:      "10px 20px",
  fontSize:     13,
  fontWeight:   700,
  cursor:       "pointer",
  letterSpacing: "-0.1px",
};

const emptyState: React.CSSProperties = {
  textAlign:    "center",
  padding:      "80px 20px",
  background:   "var(--surface)",
  border:       "2px dashed var(--border)",
  borderRadius: "var(--radius-lg)",
};

const chipStyle: React.CSSProperties = {
  fontSize:       10,
  fontFamily:     "monospace",
  padding:        "3px 8px",
  background:     "var(--surface-2)",
  color:          "var(--muted)",
  borderRadius:   6,
  border:         "1px solid var(--border)",
  textDecoration: "none",
  fontWeight:     500,
};
