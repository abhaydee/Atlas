/**
 * Tutorial — Full-screen step-by-step interactive guide.
 * Explains every feature of the Atlas — Truly permissionless markets platform.
 * Rendered as a fixed overlay; can be opened from landing or from the nav.
 */

import React, { useState, useEffect } from "react";

interface Props {
  onClose: () => void;
  onEnter?: () => void; // optional CTA on last step
}

// ── Step data ─────────────────────────────────────────────────────────────────

interface Step {
  emoji: string;
  tag: string;
  tagColor: string;
  title: string;
  body: string[];
  visual: React.ReactNode;
}

function Visual({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24,
    }}>
      {children}
    </div>
  );
}

function FlowArrow() {
  return <div style={{ color: "var(--text-4)", fontSize: 18, lineHeight: 1 }}>↓</div>;
}

function FlowBox({
  label, sub, color = "var(--accent)", icon,
}: { label: string; sub?: string; color?: string; icon?: string }) {
  return (
    <div style={{
      background: "var(--surface-2)",
      border: `1px solid ${color}44`,
      borderRadius: "var(--radius-lg)",
      padding: "12px 22px",
      textAlign: "center", minWidth: 160,
    }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: "-0.2px" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function FlowRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

function FlowArrowH() {
  return <div style={{ color: "var(--text-4)", fontSize: 18, lineHeight: 1 }}>→</div>;
}

function Highlight({ children, color = "var(--accent)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ color, fontWeight: 700 }}>{children}</span>
  );
}

const STEPS: Step[] = [
  // ── 0: What is Atlas ─────────────────────────────────────────────────────
  {
    emoji: "🌐",
    tag: "Overview",
    tagColor: "var(--accent)",
    title: "Welcome to Atlas",
    body: [
      "Atlas lets you trade synthetic versions of real-world assets — Gold, Bitcoin, Silver, Oil — without owning the underlying asset.",
      "Every market is powered by Pyth oracles, autonomous AI agents for 24/7 liquidity and arbitrage, and an on-chain AMM — no human operators.",
      "You can go long or short, provide liquidity to earn fees, or just chat to the assistant and it handles everything.",
    ],
    visual: (
      <Visual>
        <div style={{ fontSize: 52, animation: "float 5s ease-in-out infinite" }}>🌐</div>
        <FlowRow>
          <FlowBox label="Pyth Oracle" sub="Live prices" color="#E6007A" icon="🔮" />
          <FlowArrowH />
          <FlowBox label="Synthetic Vault" sub="Short / Mint" color="var(--accent)" icon="🏦" />
          <FlowArrowH />
          <FlowBox label="AMM Pool" sub="Long / Swap" color="var(--green)" icon="📈" />
        </FlowRow>
        <FlowArrow />
        <FlowRow>
          <FlowBox label="AI Agents" sub="24/7 · no human in the loop" color="var(--gold)" icon="🤖" />
          <FlowArrowH />
          <FlowBox label="You" sub="Profit 🎉" color="var(--text)" icon="👤" />
        </FlowRow>
      </Visual>
    ),
  },

  // ── 1: Oracle ────────────────────────────────────────────────────────────
  {
    emoji: "🔮",
    tag: "Prices",
    tagColor: "#E6007A",
    title: "Live Oracle Prices",
    body: [
      "Every market's price comes from Pyth Network — a professional-grade oracle used by the world's top DeFi protocols.",
      "The price refreshes every 10 seconds on-chain. If it goes stale (>2 hours old), all trades pause until it's refreshed.",
      "You'll see the oracle price displayed prominently in every market. It's the source of truth for minting, redeeming, and arbitrage.",
    ],
    visual: (
      <Visual>
        <div style={{
          background: "var(--surface-2)", border: "1px solid #E6007A44",
          borderRadius: "var(--radius-xl)", padding: "28px 40px", textAlign: "center",
          boxShadow: "0 0 40px rgba(230,0,122,0.1)",
        }}>
          <div style={{ fontSize: 11, color: "#E6007A", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, marginBottom: 8 }}>Pyth Network Oracle</div>
          <div style={{ fontSize: 54, fontWeight: 900, color: "var(--text)", fontFamily: "JetBrains Mono, monospace", letterSpacing: "-3px" }}>
            $84.63
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>sXAG / USD · updated 3s ago</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)", animation: "glow-pulse 2s infinite" }} />
            <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>Live</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center", maxWidth: 260 }}>
          Price updates propagate to vault, pool, and agents simultaneously.
        </div>
      </Visual>
    ),
  },

  // ── 2: Vault / Mint ──────────────────────────────────────────────────────
  {
    emoji: "🏦",
    tag: "Vault — Short",
    tagColor: "var(--accent)",
    title: "Mint to Go Short",
    body: [
      "Deposit USDC into the Vault to mint synthetic tokens (e.g. sGLD). The vault keeps 150% of the minted value as collateral — keeping everything fully backed.",
      "A 0.5% mint fee is retained in the vault as a safety buffer. This ensures redeemers can always be paid even during price swings.",
      "Going short means: if Gold falls from $2,000 to $1,800, your synths are now worth less — so you buy them back cheap and profit on the spread.",
    ],
    visual: (
      <Visual>
        <FlowBox label="You deposit $150 USDC" color="var(--text)" icon="💵" />
        <FlowArrow />
        <FlowBox label="0.5% fee = $0.75 USDC" sub="Stays in vault as buffer" color="var(--gold)" icon="🔒" />
        <FlowArrow />
        <FlowBox label="$149.25 backs synths" color="var(--accent)" />
        <FlowArrow />
        <FlowBox label="You receive sGLD tokens" sub="worth ~$100 at oracle price" color="var(--green)" icon="🪙" />
        <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center", maxWidth: 280 }}>
          Vault holds $150 · synths worth $100 → <Highlight>150% collateralised ✓</Highlight>
        </div>
      </Visual>
    ),
  },

  // ── 3: Vault / Redeem ────────────────────────────────────────────────────
  {
    emoji: "💵",
    tag: "Vault — Redeem",
    tagColor: "var(--accent)",
    title: "Redeem to Exit Short",
    body: [
      "Burn your synthetic tokens and receive USDC back at the current oracle price. No slippage — always oracle price.",
      "If the asset price dropped since you minted, your synths buy back fewer USDC — that's your short profit captured when you sell them high first.",
      "Arbitrageurs also use Redeem: they buy synths cheap from the AMM pool and redeem them at the oracle price for instant profit — closing the price gap.",
    ],
    visual: (
      <Visual>
        <FlowRow>
          <FlowBox label="AMM price $80" sub="(underpriced)" color="var(--gold)" icon="📉" />
          <FlowArrowH />
          <FlowBox label="Buy synths cheap" color="var(--gold)" icon="🛒" />
        </FlowRow>
        <FlowArrow />
        <FlowBox label="Redeem in Vault" sub="at oracle price $85" color="var(--accent)" icon="🏦" />
        <FlowArrow />
        <FlowBox label="Receive $85 USDC" sub="profit: $5 per synth 🎉" color="var(--green)" icon="💵" />
        <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center", maxWidth: 280 }}>
          This arb trade pulls AMM price back up → system stays in sync.
        </div>
      </Visual>
    ),
  },

  // ── 4: AMM Pool / Buy Long ───────────────────────────────────────────────
  {
    emoji: "📈",
    tag: "AMM Pool — Long",
    tagColor: "var(--green)",
    title: "Buy to Go Long",
    body: [
      "The AMM Pool is a decentralised vending machine: put USDC in, get synth tokens out. The price is determined by the ratio of USDC to synths in the pool.",
      "Buying synths = going long. If Gold rises 10%, your sGLD tokens are now worth 10% more USDC in the pool.",
      "There's a 1% swap fee on every trade (0.5% to LPs, 0.5% to the vault). Larger trades shift the pool ratio, causing price impact — shown before you confirm.",
    ],
    visual: (
      <Visual>
        <div style={{
          background: "var(--surface-2)", border: "1px solid var(--green-border)",
          borderRadius: "var(--radius-xl)", padding: "20px 28px", minWidth: 280,
          boxShadow: "0 0 30px rgba(16,217,130,0.08)",
        }}>
          <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>AMM Pool</div>
          {[
            { label: "USDC Reserve", value: "$1,000.00" },
            { label: "sGLD Reserve", value: "11.904762" },
            { label: "AMM Price", value: "$84.00" },
            { label: "Swap Fee", value: "0.5% LP · 0.5% vault" },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
              <span style={{ color: "var(--text-3)" }}>{r.label}</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: "var(--text)" }}>{r.value}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center", maxWidth: 260 }}>
          Pool price = USDC reserve ÷ synth reserve. Buys push price up, sells push it down.
        </div>
      </Visual>
    ),
  },

  // ── 5: Liquidity ─────────────────────────────────────────────────────────
  {
    emoji: "💧",
    tag: "Liquidity",
    tagColor: "var(--blue)",
    title: "Earn Fees as LP",
    body: [
      "Add both USDC and synth tokens to the pool in the current ratio. You receive LP tokens representing your share of the pool.",
      "Every time anyone swaps, 0.5% of the trade goes to you as LP and 0.5% to the vault — growing your share passively. No impermanent loss risk from oracle-based redemptions.",
      "Remove liquidity any time by burning your LP tokens. You get back USDC + synths proportional to your share, plus all accumulated fees.",
    ],
    visual: (
      <Visual>
        <FlowRow>
          <FlowBox label="$100 USDC" color="var(--accent)" icon="💵" />
          <div style={{ fontSize: 14, color: "var(--text-3)" }}>+</div>
          <FlowBox label="1.19 sGLD" color="var(--gold)" icon="🪙" />
        </FlowRow>
        <FlowArrow />
        <FlowBox label="Add to Pool" color="#3B82F6" icon="💧" />
        <FlowArrow />
        <FlowBox label="Receive LP Tokens" sub="your share certificate" color="#3B82F6" icon="🎟" />
        <FlowArrow />
        <FlowBox label="Earn 0.5% of every swap as LP" sub="0.5% to vault · proportional to share" color="var(--green)" icon="💸" />
      </Visual>
    ),
  },

  // ── 6: AI Agents ─────────────────────────────────────────────────────────
  {
    emoji: "🤖",
    tag: "AI Agents",
    tagColor: "var(--gold)",
    title: "Autonomous AI Agents",
    body: [
      "Autonomous AI agents run 24/7 in the background — Market Maker and Arbitrageur. No MetaMask, no human. Markets stay liquid and efficient.",
      "Market Maker (🏦): Seeds the AMM pool with initial USDC + synth liquidity every 5 minutes, so trading is always possible.",
      "Arbitrageur (⚡): Every 2 minutes, compares oracle price vs AMM price. If the gap exceeds 0.5%, it buys or sells to push them back together — keeping markets honest.",
    ],
    visual: (
      <Visual>
        <FlowRow>
          <div style={{
            background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
            borderRadius: "var(--radius-lg)", padding: "16px 22px", textAlign: "center",
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>🏦</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>Market Maker</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Seeds pool every 5 min</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-4)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div>both read</div>
            <div>pool state</div>
          </div>
          <div style={{
            background: "var(--gold-dim)", border: "1px solid var(--gold-border)",
            borderRadius: "var(--radius-lg)", padding: "16px 22px", textAlign: "center",
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>⚡</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>Arbitrageur</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Arbs every 2 min</div>
          </div>
        </FlowRow>
        <FlowArrow />
        <FlowBox label="AMM Pool stays healthy" sub="price tracks oracle within 0.5%" color="var(--green)" icon="✅" />
        <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center", maxWidth: 280 }}>
          Activity appears live in the <Highlight>AI Agents</Highlight> console on every market page.
        </div>
      </Visual>
    ),
  },

  // ── 7: Chatbot ───────────────────────────────────────────────────────────
  {
    emoji: "💬",
    tag: "sXAG Assistant",
    tagColor: "var(--accent)",
    title: "Chat to Trade",
    body: [
      "A floating 💬 button lives at the bottom-right of every market page. Click it to open the trading assistant.",
      "Just type what you want in plain English. The assistant parses your intent, shows you exactly what will happen, and waits for your confirmation before touching any funds.",
      "It handles approvals, slippage, and error messages automatically. No need to navigate forms.",
    ],
    visual: (
      <Visual>
        <div style={{
          width: 300, background: "var(--surface-2)", border: "1px solid var(--border-2)",
          borderRadius: "var(--radius-xl)", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}>
          {/* Chat header */}
          <div style={{ background: "var(--surface-3)", borderBottom: "1px solid var(--border)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Assistant</span>
          </div>
          {/* Messages */}
          <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ alignSelf: "flex-end", background: "var(--accent)", color: "#fff", padding: "8px 12px", borderRadius: "12px 12px 4px 12px", fontSize: 12 }}>
              mint 10 USDC
            </div>
            <div style={{ alignSelf: "flex-start", background: "var(--surface-3)", border: "1px solid var(--border)", padding: "8px 12px", borderRadius: "12px 12px 12px 4px", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
              I'll deposit <strong>10 USDC</strong> → vault.<br />
              Fee 0.5% → you receive <strong>~0.0793 sXAG</strong><br />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <div style={{ flex: 1, background: "var(--accent)", color: "#000", textAlign: "center", padding: "5px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>✓ Execute</div>
                <div style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", textAlign: "center", padding: "5px", borderRadius: 6, fontSize: 11, color: "var(--text-3)" }}>✕ Cancel</div>
              </div>
            </div>
          </div>
        </div>
      </Visual>
    ),
  },

  // ── 8: Ready ─────────────────────────────────────────────────────────────
  {
    emoji: "🚀",
    tag: "Ready",
    tagColor: "var(--green)",
    title: "You're ready to trade!",
    body: [
      "Connect your wallet to start. You'll need testnet USDC — grab some free from faucet.gokite.ai.",
      "Browse live markets or create a new one in minutes — the AI agent researches oracles, pays fees, and deploys everything. You just click once.",
      "The chatbot is always there at the bottom-right — just type what you want.",
    ],
    visual: (
      <Visual>
        <div style={{ fontSize: 64, animation: "float-slow 4s ease-in-out infinite" }}>🚀</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.5px", marginBottom: 8 }}>
            Let's go! 🎉
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.65, maxWidth: 260 }}>
            Get testnet USDC at{" "}
            <a href="https://faucet.gokite.ai/" target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
              faucet.gokite.ai ↗
            </a>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {["🏦 Mint", "📈 Buy", "💧 Add LP", "🤖 Watch agents", "💬 Chat to trade"].map((item) => (
            <div key={item} style={{
              background: "var(--surface-3)", border: "1px solid var(--border-2)",
              borderRadius: 20, padding: "5px 12px", fontSize: 11, color: "var(--text-2)", fontWeight: 600,
            }}>{item}</div>
          ))}
        </div>
      </Visual>
    ),
  },
];

// ── Tutorial Component ────────────────────────────────────────────────────────

export function Tutorial({ onClose, onEnter }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [animDir, setAnimDir] = useState<"fwd" | "bwd">("fwd");
  const [animKey, setAnimKey] = useState(0);

  // Auto-play state
  const [autoPlay, setAutoPlay] = useState(true);

  // Cursor state
  const [cursorState, setCursorState] = useState({ x: "72%", y: "45%", text: "" });
  const [clicking, setClicking] = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 20); }, []);

  function close() {
    setVisible(false);
    setTimeout(() => onClose(), 350);
  }

  function goTo(n: number, dir: "fwd" | "bwd" = "fwd") {
    setAnimDir(dir);
    setAnimKey((k) => k + 1);
    setStep(n);
  }

  function next() {
    if (step < STEPS.length - 1) goTo(step + 1, "fwd");
  }
  function prev() {
    if (step > 0) goTo(step - 1, "bwd");
  }

  // Walkthrough automatic advancement
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setTimeout(() => {
      if (step < STEPS.length - 1) {
        goTo(step + 1, "fwd");
      } else {
        setAutoPlay(false);
      }
    }, 5500);
    return () => clearTimeout(timer);
  }, [step, autoPlay]);

  // Cursor animation logic based on the step
  useEffect(() => {
    let active = true;
    let timeouts: any[] = [];

    // Helper to queue path coordinates
    const runPath = async (pts: { x: string, y: string, text: string }[]) => {
      // 1. Initial delay so human-eye can settle on new slide
      await new Promise(r => { const t = setTimeout(r, 200); timeouts.push(t); });
      for (let i = 0; i < pts.length; i++) {
        if (!active) break;
        setCursorState({ x: pts[i].x, y: pts[i].y, text: pts[i].text });

        // 2. Wait for translation (css transition 0.8s)
        await new Promise(r => { const t = setTimeout(r, 350); timeouts.push(t); });
        if (!active) break;

        // 3. Fire local click effect at destination
        setClicking(true);
        await new Promise(r => { const t = setTimeout(r, 200); timeouts.push(t); });
        setClicking(false);

        // 4. Wait for user to read text bubble before moving again
        await new Promise(r => { const t = setTimeout(r, 700); timeouts.push(t); });
      }
    };

    // Define coordinates matching the visual FlowBoxes (Right side of Card = 44% to 100%)
    let path: { x: string, y: string, text: string }[] = [];
    switch (step) {
      case 0: path = [{ x: "72%", y: "25%", text: "Welcome" }, { x: "60%", y: "45%", text: "Prices" }, { x: "84%", y: "45%", text: "Pool" }]; break;
      case 1: path = [{ x: "72%", y: "40%", text: "Live Pyth Data" }, { x: "72%", y: "60%", text: "Sub-second tracking" }]; break;
      case 2: path = [{ x: "72%", y: "25%", text: "Deposit USDC" }, { x: "72%", y: "45%", text: "Pay 0.5% fee" }, { x: "72%", y: "85%", text: "Mint sGLD" }]; break;
      case 3: path = [{ x: "62%", y: "35%", text: "Buy cheap" }, { x: "72%", y: "65%", text: "Redeem $85 Vault" }, { x: "72%", y: "85%", text: "Profit 🎉" }]; break;
      case 4: path = [{ x: "72%", y: "45%", text: "Check pool state" }, { x: "72%", y: "65%", text: "1% fee (0.5% to vault)" }]; break;
      case 5: path = [{ x: "60%", y: "25%", text: "USDC" }, { x: "84%", y: "25%", text: "Synth" }, { x: "72%", y: "50%", text: "Provide LP pair" }, { x: "72%", y: "75%", text: "Earn swap fees" }]; break;
      case 6: path = [{ x: "60%", y: "40%", text: "Seeds liquidity 🏦" }, { x: "84%", y: "40%", text: "Arbs price gaps ⚡" }, { x: "72%", y: "75%", text: "Auto manages" }]; break;
      case 7: path = [{ x: "72%", y: "35%", text: `You say "mint"` }, { x: "72%", y: "50%", text: "Previews action" }, { x: "72%", y: "70%", text: "Click ✓ Execute" }]; break;
      case 8: path = [{ x: "72%", y: "45%", text: "Get Testnet Tokens" }, { x: "72%", y: "75%", text: "Ready to start!" }]; break;
    }

    runPath(path);

    return () => {
      active = false;
      timeouts.forEach(clearTimeout);
    };
  }, [step]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Render left-aligned tooltip if cursor is heavily on the right side
  const tipX = parseInt(cursorState.x) > 80 ? -110 : 18;

  return (
    <>
      <style>{`
        @keyframes walk-ring {
          0% { transform: scale(0.2); opacity: 1; border-width: 4px; }
          100% { transform: scale(3.5); opacity: 0; border-width: 1px; }
        }
      `}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(4,6,16,0.88)",
        backdropFilter: "blur(16px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.35s ease",
        padding: 20,
      }}>
        {/* Close backdrop */}
        <div style={{ position: "absolute", inset: 0 }} onClick={close} />

        {/* Card */}
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 900,
          background: "var(--surface)",
          border: "1px solid var(--border-2)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,201,167,0.06)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
          // Removed overflow hidden so cursor doesn't clip
        }}>

          {/* ── Dynamic Walkthrough Cursor ── */}
          <div style={{
            position: "absolute",
            top: cursorState.y,
            left: cursorState.x,
            pointerEvents: "none",
            zIndex: 9999,
            transition: "top 0.35s cubic-bezier(0.25, 1, 0.5, 1), left 0.35s cubic-bezier(0.25, 1, 0.5, 1)",
            transform: `translate(-20%, -20%) ${clicking ? 'scale(0.85)' : 'scale(1)'}`,
          }}>
            {clicking && (
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
              top: -60, left: -60, right: -60, bottom: -60,
              background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 60%)',
              zIndex: -1,
            }} />

            {/* macOS style shiny cursor arrow */}
            <svg width="34" height="38" viewBox="0 0 28 32" fill="none" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.8))' }}>
              <path d="M11 29L2.83063 2.1121C2.39967 0.695349 4.15061 -0.443153 5.37893 0.457187L26.3768 15.8458C27.562 16.7143 27.2005 18.5756 25.7554 18.8953L16.2995 21L11 29Z" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>

            {/* Action text bubble */}
            {cursorState.text && (
              <div style={{
                position: "absolute",
                top: 40, left: tipX,
                background: "rgba(0,0,0,0.85)",
                backdropFilter: "blur(8px)",
                border: "1px solid var(--accent-border)",
                color: "var(--accent)",
                padding: "6px 14px",
                borderRadius: "20px",
                whiteSpace: "nowrap",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.5px",
                boxShadow: "0 0 24px rgba(0,201,167,0.3)",
                opacity: cursorState.text ? 1 : 0,
                transition: "opacity 0.3s, left 0.3s relative",
              }}>
                {cursorState.text}
              </div>
            )}
          </div>

          {/* ── Header bar ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
            borderTopLeftRadius: "calc(var(--radius-xl) - 1px)",
            borderTopRightRadius: "calc(var(--radius-xl) - 1px)",
            flexShrink: 0,
          }}>
            {/* Progress dots */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  onClick={() => { setAutoPlay(false); goTo(i, i > step ? "fwd" : "bwd"); }}
                  className={`tut-dot${i === step ? " active" : i < step ? " done" : ""}`}
                  title={STEPS[i].title}
                />
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Autoplay toggle */}
              <button
                onClick={() => setAutoPlay(!autoPlay)}
                style={{
                  background: autoPlay ? "var(--accent-dim)" : "transparent",
                  border: `1px solid ${autoPlay ? 'var(--accent-border)' : 'var(--border)'}`,
                  borderRadius: "var(--radius)",
                  color: autoPlay ? "var(--accent)" : "var(--text-3)",
                  padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                  transition: "all 0.2s"
                }}
              >
                {autoPlay ? "⏸ Stop Autoplay" : "▶ Walkthrough"}
              </button>

              <div style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "JetBrains Mono, monospace" }}>
                {step + 1} / {STEPS.length}
              </div>

              <button
                onClick={close}
                style={{
                  background: "transparent", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", color: "var(--text-3)",
                  padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                ✕ Skip
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

            {/* Left — explanation */}
            <div style={{
              flex: "0 0 44%", padding: "32px 32px",
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              animation: `${animDir === "fwd" ? "step-in" : "step-in"} 0.35s ease`,
            }} key={`left-${animKey}`}>
              {/* Tag */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: `${current.tagColor}18`,
                border: `1px solid ${current.tagColor}44`,
                borderRadius: 20, padding: "3px 12px",
                fontSize: 10, fontWeight: 700,
                color: current.tagColor,
                textTransform: "uppercase", letterSpacing: "0.6px",
                marginBottom: 18,
              }}>
                {current.emoji} {current.tag}
              </div>

              <h2 style={{
                fontSize: 28, fontWeight: 900, color: "var(--text)",
                letterSpacing: "-1px", lineHeight: 1.15,
                marginBottom: 22,
              }}>
                {current.title}
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {current.body.map((para, i) => (
                  <p key={i} style={{
                    fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, margin: 0,
                    paddingLeft: 14,
                    borderLeft: i === 0
                      ? `2px solid ${current.tagColor}`
                      : "2px solid transparent",
                  }}>
                    {para}
                  </p>
                ))}
              </div>
            </div>

            {/* Right — visual */}
            <div
              key={`right-${animKey}`}
              style={{
                flex: 1,
                background: "var(--surface-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: `${animDir === "fwd" ? "step-in" : "step-in"} 0.4s ease 0.05s both`,
                overflowY: "auto",
                position: "relative",
              }}
            >
              {current.visual}
            </div>
          </div>

          {/* ── Footer nav ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 24px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-2)",
            borderBottomLeftRadius: "calc(var(--radius-xl) - 1px)",
            borderBottomRightRadius: "calc(var(--radius-xl) - 1px)",
            flexShrink: 0,
          }}>
            <button
              onClick={() => { setAutoPlay(false); prev(); }}
              disabled={step === 0}
              style={{
                background: "transparent",
                border: "1px solid var(--border-2)",
                borderRadius: "var(--radius)",
                color: step === 0 ? "var(--text-4)" : "var(--text-2)",
                padding: "9px 20px", fontSize: 13, fontWeight: 600,
                cursor: step === 0 ? "not-allowed" : "pointer",
                opacity: step === 0 ? 0.4 : 1,
              }}
            >
              ← Back
            </button>

            {/* Step title hint */}
            <div style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center" }}>
              {isLast ? "You're all set!" : `Next: ${STEPS[step + 1]?.title}`}
            </div>

            {isLast ? (
              <button
                onClick={() => { close(); onEnter?.(); }}
                style={{
                  background: "var(--accent)", border: "none",
                  borderRadius: "var(--radius)", color: "#000",
                  padding: "9px 24px", fontSize: 13, fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 0 20px rgba(0,201,167,0.3)",
                }}
              >
                Enter App ↗
              </button>
            ) : (
              <button
                onClick={() => { setAutoPlay(false); next(); }}
                style={{
                  background: "var(--accent)", border: "none",
                  borderRadius: "var(--radius)", color: "#000",
                  padding: "9px 24px", fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

