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
          background:  { type: ColorType.Solid, color: "#0D1120" },
          textColor:   "#5A6480",
          fontFamily:  "JetBrains Mono, monospace",
          fontSize:    11,
        },
        grid: {
          vertLines: { color: "rgba(28,37,64,0.8)" },
          horzLines: { color: "rgba(28,37,64,0.8)" },
        },
        crosshair: {
          vertLine:   { color: "rgba(0,201,167,0.5)", width: 1, style: 3 },
          horzLine:   { color: "rgba(0,201,167,0.5)", width: 1, style: 3 },
        },
        rightPriceScale: {
          borderColor: "rgba(28,37,64,1)",
        },
        timeScale: {
          borderColor:     "rgba(28,37,64,1)",
          timeVisible:     cfg.resolution !== "D",
          secondsVisible:  false,
          fixLeftEdge:     true,
          fixRightEdge:    true,
        },
        width:  el.clientWidth,
        height: 300,
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor:          "#10D982",
        downColor:        "#F53B4A",
        borderUpColor:    "#10D982",
        borderDownColor:  "#F53B4A",
        wickUpColor:      "#10D982",
        wickDownColor:    "#F53B4A",
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
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)", overflow: "hidden",
      marginBottom: 20, boxShadow: "var(--shadow-card)",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>
              {symbol ?? assetSymbol} Price History
            </div>
            <div style={{ fontSize: 10, color: "var(--text-4)" }}>
              Pyth Benchmarks · {RANGE_CONFIG[range].label} · {RANGE_CONFIG[range].resolution === "D" ? "Daily" : `${RANGE_CONFIG[range].resolution}m`} candles
            </div>
          </div>
          {change && !loading && (
            <span className={`badge ${isUp ? "badge-green" : "badge-red"}`} style={{ fontSize: 11, padding: "3px 10px" }}>
              {isUp ? "+" : ""}{change.pct.toFixed(2)}% · {isUp ? "+" : ""}${Math.abs(change.abs).toFixed(2)}
            </span>
          )}
        </div>

        {/* Range buttons */}
        <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", padding: 4, borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
          {(["1D", "7D", "30D", "90D"] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} style={{
              fontSize: 11, fontWeight: 700, padding: "5px 12px", border: "none",
              borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s",
              background: r === range ? "var(--surface-4)" : "transparent",
              color: r === range ? "var(--accent)" : "var(--text-3)",
              boxShadow: r === range ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
            }}>{r}</button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div style={{ position: "relative", minHeight: 300 }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--surface)" }}>
            <div style={{ width: 28, height: 28, border: "2px solid var(--border-2)", borderTop: "2px solid var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 12 }} />
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Loading chart…</span>
          </div>
        )}
        {error && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--surface)", gap: 10 }}>
            <div style={{ fontSize: 36 }}>📉</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", maxWidth: 300, lineHeight: 1.7 }}>
              Historical data unavailable<br /><span style={{ fontSize: 11, opacity: 0.7 }}>{error}</span>
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", opacity: loading ? 0 : 1, transition: "opacity 0.25s" }} />
      </div>
    </div>
  );
}
