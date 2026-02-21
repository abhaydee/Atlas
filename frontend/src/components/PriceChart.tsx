/**
 * PriceChart — historical OHLC candlestick chart powered by Pyth Benchmarks.
 *
 * Fetches data from the backend /markets/:id/chart endpoint which proxies
 * https://benchmarks.pyth.network — no API key required.
 *
 * Uses lightweight-charts v5 (TradingView OSS library).
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candle {
  time:  number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

interface ChartResponse {
  symbol:     string;
  resolution: string;
  candles:    Candle[];
}

type Range = "1D" | "7D" | "30D" | "90D";

const RANGE_CONFIG: Record<Range, { resolution: string; seconds: number; label: string }> = {
  "1D":  { resolution: "5",   seconds: 86_400,       label: "24 Hours" },
  "7D":  { resolution: "60",  seconds: 7 * 86_400,   label: "7 Days" },
  "30D": { resolution: "240", seconds: 30 * 86_400,  label: "30 Days" },
  "90D": { resolution: "D",   seconds: 90 * 86_400,  label: "90 Days" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PriceChart({
  marketId,
  assetSymbol,
  backendUrl,
}: {
  marketId:    string;
  assetSymbol: string;
  backendUrl:  string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range,   setRange]   = useState<Range>("7D");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [symbol,  setSymbol]  = useState<string | null>(null);
  const [change,  setChange]  = useState<{ pct: number; abs: number } | null>(null);

  const fetchAndRender = useCallback(async () => {
    if (!containerRef.current) return;
    const cfg = RANGE_CONFIG[range];
    const now  = Math.floor(Date.now() / 1000);
    const from = now - cfg.seconds;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${backendUrl}/markets/${marketId}/chart`
          + `?resolution=${cfg.resolution}&from=${from}&to=${now}`
      );
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as ChartResponse;
      if (!data.candles.length) throw new Error("No historical data available");

      setSymbol(data.symbol);

      // Compute price change
      const first = data.candles[0];
      const last  = data.candles[data.candles.length - 1];
      const abs   = last.close - first.open;
      const pct   = (abs / first.open) * 100;
      setChange({ pct, abs });

      // ── Build chart ────────────────────────────────────────────────────────
      const el = containerRef.current;
      // Clear any existing chart
      el.innerHTML = "";

      const chart = createChart(el, {
        layout: {
          background:  { type: ColorType.Solid, color: "#FFFFFF" },
          textColor:   "#78736A",
          fontFamily:  "Inter, system-ui, sans-serif",
          fontSize:    11,
        },
        grid: {
          vertLines: { color: "rgba(224,217,206,0.6)" },
          horzLines: { color: "rgba(224,217,206,0.6)" },
        },
        crosshair: {
          vertLine:   { color: "rgba(200,150,58,0.6)", width: 1, style: 3 },
          horzLine:   { color: "rgba(200,150,58,0.6)", width: 1, style: 3 },
        },
        rightPriceScale: {
          borderColor: "rgba(224,217,206,0.8)",
        },
        timeScale: {
          borderColor:     "rgba(224,217,206,0.8)",
          timeVisible:     cfg.resolution !== "D",
          secondsVisible:  false,
          fixLeftEdge:     true,
          fixRightEdge:    true,
        },
        width:  el.clientWidth,
        height: 280,
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor:          "#2A7D52",
        downColor:        "#B83232",
        borderUpColor:    "#2A7D52",
        borderDownColor:  "#B83232",
        wickUpColor:      "#2A7D52",
        wickDownColor:    "#B83232",
      });

      // lightweight-charts v5 expects time as UTC seconds (number)
      series.setData(
        data.candles.map((c) => ({
          time:  c.time as unknown as import("lightweight-charts").UTCTimestamp,
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        }))
      );

      chart.timeScale().fitContent();

      // Resize observer
      const observer = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w) chart.applyOptions({ width: w });
      });
      observer.observe(el);

      // Cleanup on next render
      return () => { observer.disconnect(); chart.remove(); };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [backendUrl, marketId, range]);

  useEffect(() => {
    const cleanup = fetchAndRender();
    return () => { void cleanup.then((fn) => fn?.()); };
  }, [fetchAndRender]);

  const isUp = (change?.pct ?? 0) >= 0;

  return (
    <div style={wrapper}>
      {/* Header row */}
      <div style={headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {symbol ?? assetSymbol}{" "}
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>[</span>
            {" "}Price History{" "}
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>]</span>
          </span>
          {change && !loading && (
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: isUp ? "var(--green)" : "var(--red)",
              background: isUp ? "var(--green-light)" : "var(--red-light)",
              border: `1px solid ${isUp ? "var(--green)" : "var(--red)"}`,
              padding: "2px 8px", borderRadius: 20,
            }}>
              {isUp ? "+" : ""}{change.pct.toFixed(2)}%
              <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
                ({isUp ? "+" : ""}${Math.abs(change.abs).toFixed(2)}) {RANGE_CONFIG[range].label}
              </span>
            </span>
          )}
        </div>

        {/* Range selector */}
        <div style={rangeRow}>
          {(["1D", "7D", "30D", "90D"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={r === range ? activeRangeBtn : rangeBtn}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div style={{ position: "relative", minHeight: 280, borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)" }}>
        {loading && (
          <div style={overlay}>
            <div style={spinner} />
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Loading chart…</span>
          </div>
        )}
        {error && !loading && (
          <div style={{ ...overlay, background: "var(--surface-2)" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📈</div>
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", maxWidth: 280, lineHeight: 1.6 }}>
              Chart data unavailable<br />{error}
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", opacity: loading ? 0 : 1, transition: "opacity 0.2s" }} />
      </div>

      <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 6, textAlign: "right" }}>
        Powered by Pyth Network · {RANGE_CONFIG[range].resolution === "D" ? "Daily" : `${RANGE_CONFIG[range].resolution}m`} candles
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const wrapper: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding:      "16px 18px 12px",
  marginBottom: 20,
  boxShadow:    "var(--shadow-sm)",
};

const headerRow: React.CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
  marginBottom:   14,
  flexWrap:       "wrap",
  gap:            8,
};

const rangeRow: React.CSSProperties = {
  display: "flex",
  gap:     4,
};

const baseBtn: React.CSSProperties = {
  fontSize:     11,
  fontWeight:   600,
  padding:      "4px 10px",
  border:       "1px solid var(--border)",
  borderRadius: 20,
  cursor:       "pointer",
  transition:   "all 0.15s",
  fontFamily:   "inherit",
};

const rangeBtn: React.CSSProperties = {
  ...baseBtn,
  background: "transparent",
  color:      "var(--muted)",
};

const activeRangeBtn: React.CSSProperties = {
  ...baseBtn,
  background:  "var(--accent-light)",
  color:       "var(--accent-dark)",
  borderColor: "var(--accent)",
};

const overlay: React.CSSProperties = {
  position:       "absolute",
  inset:          0,
  display:        "flex",
  flexDirection:  "column",
  alignItems:     "center",
  justifyContent: "center",
  minHeight:      280,
  background:     "var(--surface)",
};

const spinner: React.CSSProperties = {
  width:        24,
  height:       24,
  border:       "2px solid var(--border)",
  borderTop:    "2px solid var(--accent)",
  borderRadius: "50%",
  animation:    "spin 0.8s linear infinite",
};
