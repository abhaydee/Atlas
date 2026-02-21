import React from "react";

interface Props {
  assetName:     string;
  assetSymbol:   string;
  oraclePrice:   string;
  tvl:           string;
  totalSupply:   string;
  usdcBalance:   string;
  synthBalance:  string;
  collateral:    string;
  loading:       boolean;
}

export function MarketInfo({
  assetName, assetSymbol, oraclePrice, tvl,
  totalSupply, usdcBalance, synthBalance, collateral, loading,
}: Props) {
  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px" }}>
            {assetName}{" "}
            <span style={{ color: "var(--accent)", fontSize: 20 }}>[</span>
            <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 600, margin: "0 2px" }}>{assetSymbol}</span>
            <span style={{ color: "var(--accent)", fontSize: 20 }}>]</span>
          </h2>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, fontWeight: 500 }}>
            Synthetic · Pyth Oracle · Kite Testnet
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && (
            <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span>
              refreshing
            </span>
          )}
          <span style={oracleBadge}>
            🔮 Pyth Oracle
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={gridLayout}>
        <Stat label="Oracle Price"    value={`$${oraclePrice}`}                            large highlight />
        <Stat label="Vault TVL"       value={`$${tvl}`}                                   />
        <Stat label="Total Supply"    value={`${totalSupply}`}  sub={assetSymbol}          />
        <Stat label="Collateral"      value={collateral}                                   />
        <Stat label="Your USDC"       value={`${usdcBalance}`}  sub="USDC"   wallet />
        <Stat label={`Your ${assetSymbol}`} value={synthBalance} sub={assetSymbol} wallet />
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, large, highlight, wallet,
}: {
  label: string; value: string; sub?: string;
  large?: boolean; highlight?: boolean; wallet?: boolean;
}) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize:   large ? 22 : 16,
        fontWeight: 800,
        color:      highlight ? "var(--text)" : wallet ? "var(--green)" : "var(--text-2)",
        letterSpacing: large ? "-0.5px" : "-0.2px",
      }}>
        {value}
        {sub && (
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginLeft: 4 }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding:      "22px 24px",
  marginBottom: 20,
  boxShadow:    "var(--shadow-sm)",
};

const gridLayout: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))",
  gap:                 10,
};

const statBox: React.CSSProperties = {
  background:   "var(--surface-2)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "12px 14px",
};

const oracleBadge: React.CSSProperties = {
  fontSize:     11,
  padding:      "4px 10px",
  background:   "var(--accent-light)",
  color:        "var(--accent-dark)",
  borderRadius: 20,
  fontWeight:   600,
  border:       "1px solid var(--accent)",
};
