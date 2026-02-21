import React, { useEffect, useState, useCallback } from "react";

const EXPLORER = "https://testnet.kitescan.ai";

export interface MarketSummary {
  id: string; assetName: string; assetSymbol: string;
  oraclePrice?: string; tvl?: string; totalSupply?: string; createdAt: string;
  contracts: { syntheticToken: string; syntheticVault: string; oracleAggregator: string; synthPool: string; usdc: string; oracleReader: string; mockOracle: string | null };
  paymentLog?: { amountHuman: string; txHash?: string; status: string; action?: string };
}

interface LiveData { oraclePrice: string; tvl: string; totalSupply: string }

const ASSET_META: Record<string, { icon: string; color: string }> = {
  gold:    { icon: "Au",  color: "#F59E0B" },
  silver:  { icon: "Ag",  color: "#94A3B8" },
  bitcoin: { icon: "₿",   color: "#F97316" },
  btc:     { icon: "₿",   color: "#F97316" },
  eth:     { icon: "Ξ",   color: "#818CF8" },
  oil:     { icon: "🛢",  color: "#78716C" },
  gas:     { icon: "⚡",  color: "#FBBF24" },
  apple:   { icon: "Ap",  color: "#64748B" },
  tesla:   { icon: "T",   color: "#EF4444" },
  ruby:    { icon: "◈",   color: "#EC4899" },
};

function getAssetMeta(name: string) {
  const n = name.toLowerCase();
  for (const [key, meta] of Object.entries(ASSET_META)) {
    if (n.includes(key)) return meta;
  }
  return { icon: name.slice(0, 2).toUpperCase(), color: "#00C9A7" };
}

function AssetAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const { icon, color } = getAssetMeta(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `radial-gradient(circle at 30% 30%, ${color}22, ${color}08)`,
      border: `1px solid ${color}30`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: icon.length > 1 ? 13 : 20, fontWeight: 800, color,
      fontFamily: icon.length <= 2 && /[A-Za-z]/.test(icon) ? "JetBrains Mono, monospace" : undefined,
    }}>
      {icon}
    </div>
  );
}

function ContractChip({ label, addr }: { label: string; addr: string }) {
  if (!addr) return null;
  return (
    <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", padding: "2px 8px", background: "var(--surface-2)", color: "var(--text-3)", borderRadius: 4, border: "1px solid var(--border)", textDecoration: "none" }}>
      {label}:{addr.slice(0,6)}…{addr.slice(-4)}
    </a>
  );
}

function MarketCard({ market, backendUrl, onSelect }: { market: MarketSummary; backendUrl: string; onSelect: (m: MarketSummary) => void }) {
  const [live,    setLive]    = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(false);
  const { color } = getAssetMeta(market.assetName);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/markets/${market.id}/data`);
      if (res.ok) setLive(await res.json() as LiveData);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [backendUrl, market.id]);

  useEffect(() => {
    void fetchLive();
    const t = setInterval(() => void fetchLive(), 15_000);
    return () => clearInterval(t);
  }, [fetchLive]);

  const hasPool = Boolean(market.contracts.synthPool);
  const price   = live?.oraclePrice ?? "—";
  const tvl     = live?.tvl         ?? "—";
  const supply  = live?.totalSupply ?? "—";

  return (
    <div
      onClick={() => onSelect(market)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(135deg, var(--surface-2) 0%, ${color}06 100%)`
          : "var(--surface)",
        border: `1px solid ${hovered ? color + "30" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)", padding: "20px 22px",
        cursor: "pointer",
        transition: "all 0.2s",
        transform: hovered ? "translateY(-3px)" : "none",
        boxShadow: hovered ? `0 0 0 1px ${color}20, 0 8px 24px rgba(0,0,0,0.4), 0 0 28px ${color}08` : "var(--shadow-card)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AssetAvatar name={market.assetName} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.3px" }}>{market.assetName}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 2, fontFamily: "JetBrains Mono, monospace" }}>{market.assetSymbol}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {hasPool && <span className="badge badge-green">AMM Pool</span>}
          <span style={{ fontSize: 10, color: "var(--text-4)" }}>{formatAge(market.createdAt)}</span>
        </div>
      </div>

      {/* Price */}
      <div style={{
        padding: "12px 14px", marginBottom: 14,
        background: "var(--surface-2)", borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 5 }}>
          Oracle Price · Pyth Network
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px", color: loading ? "var(--text-4)" : "var(--text)", fontFamily: "JetBrains Mono, monospace" }}>
          {loading ? <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-3)" }}>Loading…</span>
            : `$${parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Vault TVL", value: loading ? "—" : `$${parseFloat(tvl).toFixed(2)}` },
          { label: "Supply",    value: loading ? "—" : `${parseFloat(supply).toFixed(3)} ${market.assetSymbol}` },
        ].map(({ label, value }) => (
          <div key={label} style={{ flex: 1, padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)", fontFamily: "JetBrains Mono, monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Contracts */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <ContractChip label="Vault"  addr={market.contracts.syntheticVault} />
        <ContractChip label="Token"  addr={market.contracts.syntheticToken} />
        <ContractChip label="Oracle" addr={market.contracts.oracleAggregator} />
        {hasPool && <ContractChip label="Pool" addr={market.contracts.synthPool} />}
      </div>

      {/* x402 proof */}
      {market.paymentLog?.txHash && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>💳</span>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>x402 {market.paymentLog.action ?? "market.create"}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)" }}>{market.paymentLog.amountHuman}</span>
          <a href={`${EXPLORER}/tx/${market.paymentLog.txHash}`} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: "auto", fontSize: 10, color: "var(--accent)", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}>
            {market.paymentLog.txHash.slice(0,10)}… ↗
          </a>
        </div>
      )}

      {/* CTA */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="badge badge-accent">Mint / Redeem</span>
          {hasPool && <span className="badge badge-green">Swap</span>}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: hovered ? color : "var(--accent)", transition: "color 0.2s" }}>
          Trade →
        </span>
      </div>
    </div>
  );
}

export function MarketsDashboard({ backendUrl, onSelect, onCreateNew }: {
  backendUrl: string; onSelect: (m: MarketSummary) => void; onCreateNew: () => void;
}) {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/markets`);
      const data = await res.json() as { markets: MarketSummary[] };
      setMarkets(data.markets ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [backendUrl]);

  useEffect(() => {
    void fetchMarkets();
    const t = setInterval(() => void fetchMarkets(), 15_000);
    return () => clearInterval(t);
  }, [fetchMarkets]);

  if (loading) return (
    <div style={{ textAlign: "center", padding: "100px 20px", color: "var(--text-3)" }}>
      <div style={{ fontSize: 32, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 16 }}>↻</div>
      <div style={{ fontSize: 14 }}>Loading markets…</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.6px" }}>
            Live <span style={{ color: "var(--accent)" }}>[ Markets ]</span>
            <span style={{ marginLeft: 12, fontSize: 14, fontWeight: 600, padding: "3px 12px", background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)", borderRadius: 20 }}>
              {markets.length}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6, fontWeight: 500 }}>
            Click any market to trade · Powered by Pyth Network · All contracts on testnet
          </div>
        </div>
        <button onClick={onCreateNew} className="btn btn-primary" style={{ borderRadius: "var(--radius)", padding: "10px 20px" }}>
          + Create Market
        </button>
      </div>

      {markets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "100px 20px", background: "var(--surface)", border: "1px dashed var(--border-2)", borderRadius: "var(--radius-xl)" }}>
          <div style={{ fontSize: 52, marginBottom: 16, filter: "grayscale(0.3)" }}>◈</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}>No markets yet</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", maxWidth: 380, margin: "0 auto 24px", lineHeight: 1.7 }}>
            Deploy the first market — an AI agent handles Pyth research, x402 payment, and full contract deployment. Zero clicks from you.
          </div>
          <button onClick={onCreateNew} className="btn btn-primary" style={{ borderRadius: "var(--radius)", padding: "12px 24px" }}>
            Create First Market
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          {markets.map((m) => <MarketCard key={m.id} market={m} backendUrl={backendUrl} onSelect={onSelect} />)}
        </div>
      )}
    </div>
  );
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}
