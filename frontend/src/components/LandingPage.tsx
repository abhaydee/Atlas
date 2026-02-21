/**
 * LandingPage — Full-screen landing page with animated hero, feature cards,
 * how-it-works section, and tech stack. Rendered as a fixed overlay so it
 * escapes the app's 1100px container.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  onEnter: () => void;
  onTutorial: () => void;
}

// ── Data ──────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "🏦",
    tag: "Vault",
    tagColor: "var(--accent)",
    tagBg: "var(--accent-dim)",
    tagBorder: "var(--accent-border)",
    title: "Short the Market",
    desc: "Deposit USDC into the collateral vault to mint synthetic tokens. Your synths track the real-world asset price via Pyth oracles — profit when prices fall.",
    pills: ["Mint", "Redeem", "Oracle-priced", "0.5% fee buffer"],
    glowColor: "rgba(0,201,167,0.12)",
    borderGlow: "rgba(0,201,167,0.25)",
  },
  {
    icon: "📈",
    tag: "AMM Pool",
    tagColor: "var(--green)",
    tagBg: "var(--green-dim)",
    tagBorder: "var(--green-border)",
    title: "Long the Market",
    desc: "Swap USDC for synthetic tokens in the on-chain AMM. Go long on Gold, BTC, Oil — without owning the underlying. Sell back whenever you want.",
    pills: ["Buy long", "Sell to exit", "Live quote", "1% fee (0.5% to vault)"],
    glowColor: "rgba(16,217,130,0.10)",
    borderGlow: "rgba(16,217,130,0.22)",
  },
  {
    icon: "🤖",
    tag: "AI Agents",
    tagColor: "var(--gold)",
    tagBg: "var(--gold-dim)",
    tagBorder: "var(--gold-border)",
    title: "Autonomous Markets",
    desc: "Two AI agents run 24/7: a Market Maker that seeds AMM liquidity, and an Arbitrageur that closes oracle-AMM price gaps — keeping every market healthy.",
    pills: ["Market Maker", "Arbitrageur", "Always on", "No MetaMask"],
    glowColor: "rgba(245,158,11,0.10)",
    borderGlow: "rgba(245,158,11,0.22)",
  },
];

const HOW_IT_WORKS = [
  {
    n: "01",
    icon: "🔍",
    title: "Pick a Market",
    desc: "Browse AI-deployed synthetic markets — Gold, Bitcoin, Silver, Oil — or spin up your own in under 3 minutes.",
  },
  {
    n: "02",
    icon: "💰",
    title: "Fund Your Position",
    desc: "Deposit USDC to mint synths (short), or swap USDC in the AMM pool to go long. The chatbot can do it with one sentence.",
  },
  {
    n: "03",
    icon: "🔮",
    title: "Prices Update Live",
    desc: "Pyth Network oracle prices update every 10 seconds. AI agents arbitrage any deviation between the pool price and oracle.",
  },
  {
    n: "04",
    icon: "💸",
    title: "Exit & Profit",
    desc: "Redeem synths at oracle price, sell in the AMM pool, or earn passive 0.5% fees as LP (0.5% to vault).",
  },
];

const TECH_STACK = [
  { label: "Pyth Network", sub: "Oracle feeds", color: "#E6007A" },
  { label: "x402 Protocol", sub: "AI payments", color: "#00C9A7" },
  { label: "Testnet", sub: "EVM chain", color: "#3B82F6" },
  { label: "Ethers v6", sub: "Web3 library", color: "#7C3AED" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function LandingPage({ onEnter, onTutorial }: Props) {
  const [cursor, setCursor] = useState({ x: -999, y: -999 });
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Simulated animated cursor state
  const [autoCursor, setAutoCursor] = useState({ x: "50%", y: "20%", text: "Welcome to Atlas" });
  const [autoClicking, setAutoClicking] = useState(false);

  useEffect(() => {
    let active = true;
    let timeouts: any[] = [];

    const runPath = async () => {
      const pts = [
        { x: "50%", y: "15%", text: "Welcome to Atlas" },
        { x: "25%", y: "55%", text: "Short the Market" },
        { x: "50%", y: "55%", text: "Long via AMM" },
        { x: "75%", y: "55%", text: "Autonomous Agents" },
        { x: "50%", y: "85%", text: "Chat to Trade 💬" },
        { x: "42%", y: "40%", text: "Launch App 🚀" }
      ];
      await new Promise(r => { const t = setTimeout(r, 200); timeouts.push(t); });
      for (let i = 0; i < pts.length; i++) {
        if (!active) break;
        setAutoCursor({ x: pts[i].x, y: pts[i].y, text: pts[i].text });

        await new Promise(r => { const t = setTimeout(r, 350); timeouts.push(t); });
        if (!active) break;

        setAutoClicking(true);
        await new Promise(r => { const t = setTimeout(r, 150); timeouts.push(t); });
        setAutoClicking(false);

        await new Promise(r => { const t = setTimeout(r, 800); timeouts.push(t); });
      }
      if (active) runPath();
    };

    runPath();

    return () => {
      active = false;
      timeouts.forEach(clearTimeout);
    };
  }, []);

  // Fade in on mount
  useEffect(() => { setTimeout(() => setVisible(true), 30); }, []);

  // Scroll reveal for feature cards
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const idx = cardRefs.current.indexOf(e.target as HTMLDivElement);
          if (e.isIntersecting && idx !== -1)
            setRevealed((prev) => new Set([...prev, idx]));
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    cardRefs.current.forEach((r) => r && obs.observe(r));
    return () => obs.disconnect();
  }, []);

  const trackMouse = useCallback((e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
  }, []);

  function handleEnter() {
    setExiting(true);
    setTimeout(() => onEnter(), 480);
  }

  return (
    <>
      <style>{`
        @keyframes walk-ring {
          0% { transform: scale(0.2); opacity: 1; border-width: 4px; }
          100% { transform: scale(3.5); opacity: 0; border-width: 1px; }
        }
      `}</style>
      <div
        onMouseMove={trackMouse}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--bg)",
          overflowY: "auto",
          zIndex: 200,
          opacity: visible && !exiting ? 1 : 0,
          transform: exiting ? "scale(0.96)" : "scale(1)",
          transition: "opacity 0.45s ease, transform 0.45s ease",
        }}
      >
        {/* ── Dynamic Walkthrough Cursor ── */}
        <div style={{
          position: "fixed",
          top: autoCursor.y,
          left: autoCursor.x,
          pointerEvents: "none",
          zIndex: 9999,
          transition: "top 0.35s cubic-bezier(0.25, 1, 0.5, 1), left 0.35s cubic-bezier(0.25, 1, 0.5, 1)",
          transform: `translate(-20%, -20%) ${autoClicking ? 'scale(0.85)' : 'scale(1)'}`,
        }}>
          {autoClicking && (
            <div style={{
              position: "absolute",
              top: -8, left: -8, right: -8, bottom: -8,
              borderRadius: "50%",
              borderColor: "var(--accent)",
              borderStyle: "solid",
              animation: "walk-ring 0.6s ease-out forwards",
            }} />
          )}

          {/* Glow backdrop behind the cursor */}
          <div style={{
            position: 'absolute',
            top: -120, left: -120, right: -120, bottom: -120,
            background: 'radial-gradient(circle, rgba(0,201,167,0.18) 0%, transparent 60%)',
            zIndex: -1,
          }} />

          {/* macOS style shiny cursor arrow */}
          <svg width="42" height="46" viewBox="0 0 28 32" fill="none" style={{ filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.9))' }}>
            <path d="M11 29L2.83063 2.1121C2.39967 0.695349 4.15061 -0.443153 5.37893 0.457187L26.3768 15.8458C27.562 16.7143 27.2005 18.5756 25.7554 18.8953L16.2995 21L11 29Z" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>

          {/* Action text bubble */}
          {autoCursor.text && (
            <div style={{
              position: "absolute",
              top: 50, left: parseInt(autoCursor.x) > 80 ? -120 : 25,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(8px)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
              padding: "8px 18px",
              borderRadius: "20px",
              whiteSpace: "nowrap",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.5px",
              boxShadow: "0 0 30px rgba(0,201,167,0.4)",
              opacity: autoCursor.text ? 1 : 0,
              transition: "opacity 0.3s, left 0.3s relative",
            }}>
              {autoCursor.text}
            </div>
          )}
        </div>

        {/* ── Mouse-following glow ── */}
        <div style={{
          position: "fixed",
          width: 600, height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,201,167,0.055) 0%, transparent 65%)",
          pointerEvents: "none",
          zIndex: 1,
          left: cursor.x - 300,
          top: cursor.y - 300,
          transition: "left 0.12s ease-out, top 0.12s ease-out",
        }} />

        {/* ── Grid background ── */}
        <div className="grid-bg" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, opacity: 0.6 }} />

        {/* ── Animated gradient orbs ── */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "8%", left: "12%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,201,167,0.09) 0%, transparent 68%)", animation: "orb-drift 14s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "55%", right: "8%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.07) 0%, transparent 65%)", animation: "orb-drift 18s ease-in-out infinite 3s" }} />
          <div style={{ position: "absolute", top: "30%", right: "35%", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,217,130,0.06) 0%, transparent 65%)", animation: "orb-drift 11s ease-in-out infinite 6s" }} />
          <div style={{ position: "absolute", top: "75%", left: "25%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)", animation: "orb-drift 16s ease-in-out infinite 9s" }} />
        </div>

        {/* ════════════════════════════════════════
          NAV
      ════════════════════════════════════════ */}
        <nav style={{
          position: "sticky", top: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 40px", height: 64,
          background: "rgba(8,12,24,0.75)",
          backdropFilter: "blur(20px) saturate(1.8)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AtlasDiamond size={28} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.4px", lineHeight: 1 }}>
                Atlas <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>[ Synthetic Markets ]</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-4)", letterSpacing: "0.3px" }}>
                Pyth Oracles · x402 Protocol · Testnet
              </div>
            </div>
          </div>

          {/* Nav actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onTutorial}
              style={{
                background: "transparent",
                border: "1px solid var(--border-2)",
                borderRadius: "var(--radius)",
                color: "var(--text-2)",
                padding: "8px 16px",
                fontSize: 13, fontWeight: 600,
                cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.target as HTMLButtonElement).style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.borderColor = "var(--border-2)"; (e.target as HTMLButtonElement).style.color = "var(--text-2)"; }}
            >
              How it works
            </button>
            <button
              onClick={handleEnter}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius)",
                color: "#000",
                padding: "8px 20px",
                fontSize: 13, fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 0 20px rgba(0,201,167,0.3)",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = "var(--accent-2)"; (e.target as HTMLButtonElement).style.boxShadow = "0 0 32px rgba(0,201,167,0.5)"; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "var(--accent)"; (e.target as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(0,201,167,0.3)"; }}
            >
              Enter App →
            </button>
          </div>
        </nav>

        {/* ════════════════════════════════════════
          HERO
      ════════════════════════════════════════ */}
        <section style={{
          position: "relative",
          minHeight: "90vh",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          textAlign: "center",
          padding: "80px 40px 60px",
          zIndex: 2,
        }}>
          {/* Eyebrow badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
            borderRadius: 20, padding: "5px 14px",
            fontSize: 11, fontWeight: 700, color: "var(--accent)",
            letterSpacing: "0.6px", textTransform: "uppercase",
            marginBottom: 28,
            animation: "fadeIn 0.8s ease 0.1s both",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", animation: "glow-pulse 2s infinite", display: "inline-block" }} />
            Live on Testnet
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: "clamp(42px, 7vw, 88px)",
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: "-3px",
            marginBottom: 20,
            animation: "reveal-up 0.8s ease 0.2s both",
            maxWidth: 900,
          }}>
            <span className="gradient-text">Atlas</span>
            <br />
            <span style={{ color: "var(--text)", fontWeight: 800, fontSize: "0.5em", letterSpacing: "-1.5px" }}>
              Synthetic Markets
            </span>
            <br />
            <span style={{ color: "var(--text-3)", fontWeight: 700, fontSize: "0.45em", letterSpacing: "-1px" }}>
              Powered by AI · Priced by Pyth
            </span>
          </h1>

          {/* Sub */}
          <p style={{
            fontSize: "clamp(15px, 2vw, 20px)",
            color: "var(--text-2)",
            maxWidth: 620,
            lineHeight: 1.65,
            marginBottom: 44,
            animation: "reveal-up 0.8s ease 0.35s both",
            fontWeight: 400,
          }}>
            Trade synthetic Gold, Bitcoin, Oil, and any real-world asset — long or short —
            with on-chain AI agents that keep markets liquid and fair,{" "}
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>24/7.</span>
          </p>

          {/* CTAs */}
          <div style={{
            display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center",
            animation: "reveal-up 0.8s ease 0.5s both",
            marginBottom: 72,
          }}>
            <button
              onClick={handleEnter}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius)",
                color: "#000",
                padding: "15px 36px",
                fontSize: 16, fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 0 40px rgba(0,201,167,0.35)",
                transition: "all 0.2s ease",
                letterSpacing: "-0.3px",
              }}
              onMouseEnter={(e) => { const b = e.currentTarget; b.style.transform = "translateY(-2px)"; b.style.boxShadow = "0 8px 48px rgba(0,201,167,0.55)"; }}
              onMouseLeave={(e) => { const b = e.currentTarget; b.style.transform = "translateY(0)"; b.style.boxShadow = "0 0 40px rgba(0,201,167,0.35)"; }}
            >
              Launch App ↗
            </button>
            <button
              onClick={onTutorial}
              style={{
                background: "transparent",
                border: "1px solid var(--border-2)",
                borderRadius: "var(--radius)",
                color: "var(--text)",
                padding: "15px 32px",
                fontSize: 16, fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                backdropFilter: "blur(8px)",
              }}
              onMouseEnter={(e) => { const b = e.currentTarget; b.style.borderColor = "var(--accent)"; b.style.color = "var(--accent)"; b.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { const b = e.currentTarget; b.style.borderColor = "var(--border-2)"; b.style.color = "var(--text)"; b.style.transform = "translateY(0)"; }}
            >
              Watch Tutorial →
            </button>
          </div>

          {/* Stat pills */}
          <div style={{
            display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center",
            animation: "reveal-up 0.8s ease 0.65s both",
          }}>
            {[
              { label: "Oracle Feeds", value: "Pyth Network", color: "#E6007A" },
              { label: "Collateral Model", value: "150% Over-collateralised", color: "var(--green)" },
              { label: "Swap Fee", value: "0.5% LPs · 0.5% vault", color: "var(--accent)" },
              { label: "Mint Fee", value: "0.5% → Safety Buffer", color: "var(--gold)" },
            ].map((s) => (
              <div key={s.label} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
                borderRadius: 20, padding: "6px 16px",
                fontSize: 12,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <span style={{ color: "var(--text-3)" }}>{s.label}:</span>
                <span style={{ fontWeight: 700, color: "var(--text)", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Scroll indicator */}
          <div style={{
            position: "absolute", bottom: 28,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            color: "var(--text-4)", fontSize: 11, letterSpacing: "0.4px",
            animation: "fadeIn 1s ease 1.2s both",
          }}>
            <span>scroll</span>
            <div style={{ width: 1, height: 32, background: "linear-gradient(var(--accent), transparent)" }} />
          </div>
        </section>

        {/* ════════════════════════════════════════
          FEATURES
      ════════════════════════════════════════ */}
        <section style={{ padding: "80px 40px", maxWidth: 1200, margin: "0 auto", zIndex: 2, position: "relative" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>
              What you can do
            </div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 46px)", fontWeight: 900, letterSpacing: "-1.5px", color: "var(--text)" }}>
              Three ways to trade
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                ref={(el) => { cardRefs.current[i] = el; }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: hovered === i
                    ? `radial-gradient(circle at 30% 30%, ${f.glowColor}, var(--surface) 60%)`
                    : "var(--surface)",
                  border: `1px solid ${hovered === i ? f.borderGlow : "var(--border)"}`,
                  borderRadius: "var(--radius-xl)",
                  padding: "32px 28px",
                  cursor: "default",
                  transition: "all 0.3s ease",
                  transform: hovered === i ? "translateY(-6px)" : "translateY(0)",
                  boxShadow: hovered === i
                    ? `0 20px 60px ${f.glowColor}, 0 0 0 1px ${f.borderGlow}`
                    : "var(--shadow-card)",
                  opacity: revealed.has(i) ? 1 : 0,
                  animation: revealed.has(i)
                    ? `card-reveal 0.6s ease ${i * 0.12}s both`
                    : "none",
                }}
              >
                {/* Icon + tag */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: f.glowColor, border: `1px solid ${f.borderGlow}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22,
                  }}>
                    {f.icon}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color: f.tagColor,
                    background: f.tagBg, border: `1px solid ${f.tagBorder}`,
                    borderRadius: 20, padding: "3px 10px",
                    textTransform: "uppercase", letterSpacing: "0.6px",
                  }}>
                    {f.tag}
                  </span>
                </div>

                <h3 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 12, letterSpacing: "-0.5px" }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65, marginBottom: 22 }}>
                  {f.desc}
                </p>

                {/* Pills */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {f.pills.map((p) => (
                    <span key={p} style={{
                      fontSize: 10, fontWeight: 600,
                      color: "var(--text-3)",
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      borderRadius: 20, padding: "3px 10px",
                    }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════ */}
        <section style={{ padding: "80px 40px", position: "relative", zIndex: 2 }}>
          {/* Divider line */}
          <div style={{ maxWidth: 900, margin: "0 auto 64px", height: 1, background: "linear-gradient(90deg, transparent, var(--border-2), transparent)" }} />

          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14 }}>
                Step by step
              </div>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 46px)", fontWeight: 900, letterSpacing: "-1.5px", color: "var(--text)" }}>
                How it works
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 0 }}>
              {HOW_IT_WORKS.map((step, i) => (
                <div
                  key={step.n}
                  ref={(el) => { cardRefs.current[FEATURES.length + i] = el; }}
                  style={{
                    padding: "32px 28px",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                    opacity: revealed.has(FEATURES.length + i) ? 1 : 0,
                    animation: revealed.has(FEATURES.length + i)
                      ? `reveal-up 0.6s ease ${i * 0.15}s both`
                      : "none",
                  }}
                >
                  {/* Step number */}
                  <div style={{
                    fontSize: 11, fontWeight: 800,
                    fontFamily: "JetBrains Mono, monospace",
                    color: "var(--accent)", opacity: 0.5,
                    letterSpacing: "2px", marginBottom: 12,
                  }}>
                    {step.n}
                  </div>

                  {/* Icon */}
                  <div style={{ fontSize: 28, marginBottom: 14 }}>{step.icon}</div>

                  <h4 style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 10, letterSpacing: "-0.3px" }}>
                    {step.title}
                  </h4>
                  <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
                    {step.desc}
                  </p>

                  {/* Connector arrow (not on last) */}
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div style={{
                      position: "absolute",
                      right: -10, top: "50%",
                      color: "var(--border-2)",
                      fontSize: 18, pointerEvents: "none",
                      display: "none", // hidden — border handles visual flow
                    }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════
          CHATBOT CALLOUT
      ════════════════════════════════════════ */}
        <section style={{ padding: "60px 40px", position: "relative", zIndex: 2 }}>
          <div style={{
            maxWidth: 800, margin: "0 auto",
            background: "linear-gradient(135deg, rgba(0,201,167,0.06) 0%, var(--surface) 60%, rgba(245,158,11,0.04) 100%)",
            border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-xl)",
            padding: "44px 48px",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* Background glow */}
            <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 300, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,201,167,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

            <div style={{ fontSize: 36, marginBottom: 16 }}>💬</div>
            <h3 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-1px", color: "var(--text)", marginBottom: 12 }}>
              Trade by <span className="gradient-text-gold">chatting</span>
            </h3>
            <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.65, maxWidth: 520, margin: "0 auto 28px" }}>
              Don't navigate forms. Just type what you want — the built-in assistant handles approvals, quotes, and transactions automatically.
            </p>

            {/* Example prompts */}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 32 }}>
              {['"mint 10 USDC"', '"buy 5 USDC of sGLD"', '"sell 0.001 sGLD"', '"what\'s the price?"'].map((ex) => (
                <div key={ex} style={{
                  background: "var(--surface-2)", border: "1px solid var(--border-2)",
                  borderRadius: "var(--radius)", padding: "7px 14px",
                  fontSize: 12, color: "var(--accent)",
                  fontFamily: "JetBrains Mono, monospace",
                }}>
                  {ex}
                </div>
              ))}
            </div>

            <button
              onClick={handleEnter}
              style={{
                background: "var(--accent)", border: "none",
                borderRadius: "var(--radius)", color: "#000",
                padding: "12px 28px", fontSize: 14, fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 0 24px rgba(0,201,167,0.3)",
              }}
            >
              Try it now →
            </button>
          </div>
        </section>

        {/* ════════════════════════════════════════
          TECH STACK
      ════════════════════════════════════════ */}
        <section style={{ padding: "48px 40px 80px", position: "relative", zIndex: 2 }}>
          <div style={{ maxWidth: 900, margin: "0 auto 32px", height: 1, background: "linear-gradient(90deg, transparent, var(--border), transparent)" }} />

          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "1.5px" }}>
              Built on
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
            {TECH_STACK.map((t) => (
              <div key={t.label} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "14px 24px",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                transition: "border-color 0.2s",
                cursor: "default",
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = t.color + "44"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.color, marginBottom: 2 }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-4)" }}>{t.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════ */}
        <footer style={{
          borderTop: "1px solid var(--border)",
          padding: "24px 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "relative", zIndex: 2,
          background: "rgba(8,12,24,0.6)", backdropFilter: "blur(10px)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AtlasDiamond size={18} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)" }}>
              Atlas Synthetic Markets
            </span>
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>— Testnet</span>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <button onClick={onTutorial} style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 12, cursor: "pointer" }}>Tutorial</button>
            <button onClick={handleEnter} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Enter App →</button>
          </div>
        </footer>
      </div>
    </>
  );
}

// ── Atlas Diamond Logo ───────────────────────────────────────────────────────
function AtlasDiamond({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 1L31 16L16 31L1 16Z" fill="url(#land-kite-grad)" />
      <path d="M16 7L25 16L16 25L7 16Z" fill="rgba(0,0,0,0.35)" />
      <circle cx="16" cy="16" r="3" fill="#00C9A7" style={{ filter: "drop-shadow(0 0 4px #00C9A7)" }} />
      <defs>
        <linearGradient id="land-kite-grad" x1="1" y1="1" x2="31" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E3A5F" />
          <stop offset="50%" stopColor="#243660" />
          <stop offset="100%" stopColor="#00C9A7" stopOpacity="0.8" />
        </linearGradient>
      </defs>
    </svg>
  );
}
