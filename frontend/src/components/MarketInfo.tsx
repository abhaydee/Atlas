import React from "react";

interface Props {
  assetName: string; assetSymbol: string; oraclePrice: string;
  tvl: string; totalSupply: string; usdcBalance: string;
  synthBalance: string; collateral: string; loading: boolean;
  excessCollateral: string; accumulatedFees: string;
}

export function MarketInfo({
  assetName, assetSymbol, oraclePrice, tvl,
  totalSupply, usdcBalance, synthBalance, collateral, loading,
  excessCollateral, accumulatedFees,
}: Props) {
  const price = parseFloat(oraclePrice);

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      marginBottom: 20,
      overflow: "hidden",
      boxShadow: "var(--shadow-card)",
    }}>
      {/* Hero price row */}
      <div style={{
        padding: "22px 28px 20px",
        background: "linear-gradient(135deg, var(--surface) 0%, rgba(0,201,167,0.04) 100%)",
        borderBottom: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", margin: 0, letterSpacing: "-0.5px" }}>
              {assetName}
            </h2>
            <span className="badge badge-accent" style={{ fontSize: 11 }}>{assetSymbol}</span>
            {loading && (
              <span style={{ fontSize: 11, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span> syncing
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: "var(--text)", letterSpacing: "-1.5px", fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
              ${price ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : oraclePrice}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>USD</div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>🔮</span>
            <span>Pyth Network oracle · Updated every 10s</span>
          </div>
        </div>

        {/* Collateral badge */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Collateral</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "var(--green)", fontFamily: "JetBrains Mono, monospace" }}>{collateral}</div>
          <div style={{ fontSize: 10, color: "var(--green)", marginTop: 2 }}>fully backed</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "none" }}>
        {[
          { label: "Vault TVL",    value: `$${parseFloat(tvl || "0").toFixed(2)}`,           sub: "USDC",      dim: false, color: undefined },
          { label: "Total Supply", value: parseFloat(totalSupply || "0").toFixed(4),          sub: assetSymbol, dim: false, color: undefined },
          { label: `Your ${assetSymbol}`, value: parseFloat(synthBalance || "0").toFixed(6), sub: assetSymbol, dim: true,  color: undefined },
        ].map(({ label, value, sub, dim, color }, i, arr) => (
          <div key={label} style={{
            padding: "14px 20px",
            borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: color ?? (dim ? "var(--accent)" : "var(--text)"), fontFamily: "JetBrains Mono, monospace", letterSpacing: "-0.3px" }}>
              {value}
              <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-3)", marginLeft: 4, fontFamily: "inherit" }}>{sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Fee buffer row */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        borderTop: "1px solid var(--border)",
        background: "rgba(0,201,167,0.03)",
      }}>
        <div style={{ padding: "11px 20px", borderRight: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 5 }}>
            Surplus Collateral
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--green)", fontFamily: "JetBrains Mono, monospace" }}>
              ${parseFloat(excessCollateral || "0").toFixed(4)}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>USDC above minimum</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 3 }}>
            Buffer for arb redemptions · grows with every mint
          </div>
        </div>
        <div style={{ padding: "11px 20px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 5 }}>
            Accumulated Mint Fees
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--gold)", fontFamily: "JetBrains Mono, monospace" }}>
              ${parseFloat(accumulatedFees || "0").toFixed(4)}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>USDC · 0.5% per mint</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 3 }}>
            Retained in vault · never paid out · pure collateral
          </div>
        </div>
      </div>
    </div>
  );
}
