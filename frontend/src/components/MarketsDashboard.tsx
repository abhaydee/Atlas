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
  };
}

interface LiveData {
  oraclePrice: string;
  tvl:         string;
  totalSupply: string;
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
  const [live, setLive] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);

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

  const price      = live?.oraclePrice ?? "—";
  const tvl        = live?.tvl        ?? "—";
  const supply     = live?.totalSupply ?? "—";
  const hasPool    = Boolean(market.contracts.synthPool);
  const age        = formatAge(market.createdAt);

  return (
    <div style={cardStyle} onClick={() => onSelect(market)}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{market.assetName}</div>
          <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{market.assetSymbol}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {hasPool && <span style={poolBadge}>AMM Pool</span>}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{age}</span>
        </div>
      </div>

      {/* Price */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Oracle Price</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: loading ? "var(--muted)" : "var(--green)" }}>
          {loading ? "Loading…" : `$${parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        <Stat label="Vault TVL"    value={loading ? "—" : `$${parseFloat(tvl).toFixed(2)}`} />
        <Stat label="Total Supply" value={loading ? "—" : `${parseFloat(supply).toFixed(4)} ${market.assetSymbol}`} />
      </div>

      {/* Contracts */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <ContractChip label="Vault"  addr={market.contracts.syntheticVault} />
        <ContractChip label="Token"  addr={market.contracts.syntheticToken} />
        <ContractChip label="Oracle" addr={market.contracts.oracleAggregator} />
        {hasPool && <ContractChip label="Pool" addr={market.contracts.synthPool} />}
      </div>

      {/* Payment proof */}
      {market.paymentLog?.txHash && (
        <div style={{ fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          x402 settlement:{" "}
          <a
            href={`${KITE_EXPLORER}/tx/${market.paymentLog.txHash}`}
            target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--accent)", textDecoration: "none", fontFamily: "monospace" }}
          >
            {market.paymentLog.txHash.slice(0, 12)}… ↗
          </a>
        </div>
      )}

      {/* CTA */}
      <div style={ctaRow}>
        <span style={ctaBtn}>Trade {market.assetSymbol} →</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{value}</div>
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
    return <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Loading markets…</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            Live Markets
            <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600, padding: "2px 8px", background: "rgba(108,99,255,0.15)", color: "var(--accent)", borderRadius: 12 }}>
              {markets.length}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Click a market to trade · All deployed on Kite Testnet
          </div>
        </div>
        <button onClick={onCreateNew} style={createBtn}>
          + Create New Market
        </button>
      </div>

      {/* Grid */}
      {markets.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No markets yet</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            Deploy the first synthetic market — the agent handles everything autonomously.
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
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap:                 16,
};

const cardStyle: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "18px 20px",
  cursor:       "pointer",
  transition:   "border-color 0.15s, transform 0.1s",
};

const ctaRow: React.CSSProperties = {
  marginTop:   12,
  borderTop:   "1px solid var(--border)",
  paddingTop:  10,
  textAlign:   "right",
};

const ctaBtn: React.CSSProperties = {
  fontSize:   13,
  fontWeight: 700,
  color:      "var(--accent)",
};

const createBtn: React.CSSProperties = {
  background:   "var(--accent)",
  color:        "#fff",
  border:       "none",
  borderRadius: "var(--radius)",
  padding:      "9px 18px",
  fontSize:     14,
  fontWeight:   700,
  cursor:       "pointer",
};

const emptyState: React.CSSProperties = {
  textAlign:    "center",
  padding:      "60px 20px",
  background:   "var(--surface)",
  border:       "1px dashed var(--border)",
  borderRadius: "var(--radius)",
};

const poolBadge: React.CSSProperties = {
  fontSize:   10,
  fontWeight: 700,
  padding:    "2px 7px",
  background: "rgba(52,199,89,0.15)",
  color:      "var(--green)",
  borderRadius: 10,
};

const chipStyle: React.CSSProperties = {
  fontSize:     10,
  fontFamily:   "monospace",
  padding:      "2px 7px",
  background:   "var(--bg)",
  color:        "var(--muted)",
  borderRadius: 4,
  border:       "1px solid var(--border)",
  textDecoration: "none",
};
