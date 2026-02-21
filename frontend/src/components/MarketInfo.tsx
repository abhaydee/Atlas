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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "var(--accent)" }}>
          {assetName}
          <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>
            ({assetSymbol})
          </span>
        </h2>
        {loading && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>refreshing…</span>
        )}
      </div>

      <div style={grid}>
        <Stat label="Oracle Price"   value={`$${oraclePrice}`}   />
        <Stat label="Vault TVL"      value={`${tvl} USDC`}       />
        <Stat label="Total Supply"   value={`${totalSupply} ${assetSymbol}`} />
        <Stat label="Collateral Ratio" value={collateral}        />
        <Stat label="Your USDC"      value={`${usdcBalance} USDC`} accent />
        <Stat label={`Your ${assetSymbol}`} value={`${synthBalance} ${assetSymbol}`} accent />
      </div>
    </div>
  );
}

function Stat({
  label, value, accent,
}: {
  label: string; value: string; accent?: boolean;
}) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: accent ? "var(--green)" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      24,
  marginBottom: 20,
};

const grid: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap:                 12,
};

const statBox: React.CSSProperties = {
  background:   "var(--bg)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "12px 14px",
};
