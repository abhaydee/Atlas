/**
 * ChatBot — Floating natural-language interface for market actions.
 *
 * Supports: mint · redeem · buy (long) · sell · add liquidity · remove liquidity
 * Info queries: price · balance · help
 *
 * Parses the user's message client-side, builds a confirmation card,
 * then executes the exact same on-chain calls the UI panels use.
 */

import React, { useState, useRef, useEffect } from "react";
import { ethers } from "ethers";
import { SYNTHETIC_VAULT_ABI, ERC20_ABI, SYNTH_POOL_ABI } from "../lib/abis.ts";

const EXPLORER     = "https://testnet.kitescan.ai";
const MINT_FEE_BPS = 50; // must match SyntheticVault.sol constant
const COL_RATIO    = 1.5; // must match contract

// ── Types ─────────────────────────────────────────────────────────────────────

type ActionType = "mint" | "redeem" | "buy" | "sell" | "add-liquidity" | "remove-liquidity";

interface ParsedAction { type: ActionType; amount: number }

interface Message {
  id:       number;
  role:     "user" | "bot";
  text:     string;
  action?:  ParsedAction;
  txHash?:  string;
  isError?: boolean;
}

interface Props {
  signer:        ethers.JsonRpcSigner | null;
  vaultAddress:  string;
  usdcAddress:   string;
  synthAddress:  string;
  poolAddress:   string;
  assetSymbol:   string;
  oraclePrice:   string;
  usdcBalance:   string;
  synthBalance:  string;
  onSuccess:     () => void;
}

// ── Intent parser ─────────────────────────────────────────────────────────────

function parseIntent(text: string): ParsedAction | null {
  const t   = text.toLowerCase().trim();
  const num = parseFloat((t.match(/([\d.]+)/) ?? [])[1] ?? "");
  if (isNaN(num) || num <= 0) {
    // Commands without amounts
    return null;
  }
  if (/\bmint\b/.test(t))                                       return { type: "mint",             amount: num };
  if (/\bredeem\b/.test(t))                                     return { type: "redeem",           amount: num };
  if (/\bbuy\b/.test(t) || (/\bswap\b/.test(t) && /usdc|dollar/i.test(t))) return { type: "buy", amount: num };
  if (/\bsell\b/.test(t))                                       return { type: "sell",             amount: num };
  if (/\badd\b/.test(t) && /liquidity|lp/i.test(t))            return { type: "add-liquidity",    amount: num };
  if (/\bremove\b/.test(t) && /liquidity|lp/i.test(t))         return { type: "remove-liquidity", amount: num };
  // Fallback: single keyword + number
  if (/\badd\b/.test(t))    return { type: "add-liquidity",    amount: num };
  if (/\bremove\b/.test(t)) return { type: "remove-liquidity", amount: num };
  return null;
}

function buildReply(a: ParsedAction, symbol: string, oraclePrice: string): string {
  const price = parseFloat(oraclePrice) || 0;
  switch (a.type) {
    case "mint": {
      const net = a.amount * (1 - MINT_FEE_BPS / 10_000);
      const est = price > 0 ? (net / (price * COL_RATIO)).toFixed(6) : "?";
      return `I'll deposit **${a.amount} USDC** into the vault.\n0.5% fee applied → you receive **~${est} ${symbol}** at oracle price.\n\nConfirm?`;
    }
    case "redeem": {
      const est = price > 0 ? (a.amount * price).toFixed(4) : "?";
      return `I'll burn **${a.amount} ${symbol}** → you get back **~$${est} USDC** at oracle price.\n\nConfirm?`;
    }
    case "buy":
      return `I'll spend **${a.amount} USDC** in the AMM pool to buy ${symbol} (long position).\n\nConfirm?`;
    case "sell":
      return `I'll sell **${a.amount} ${symbol}** back to the AMM pool for USDC.\n\nConfirm?`;
    case "add-liquidity":
      return `I'll add **${a.amount} USDC** + proportional ${symbol} to the AMM pool.\nYou'll earn **1% of every swap** on your share.\n\nConfirm?`;
    case "remove-liquidity":
      return `I'll burn **${a.amount} LP tokens** and return your USDC + ${symbol}.\n\nConfirm?`;
  }
}

const HELP_TEXT = (sym: string) =>
  `Here's what I can do:\n• **mint** [usdc]  — deposit USDC, get ${sym}\n• **redeem** [amount]  — burn ${sym}, get USDC\n• **buy** [usdc]  — go long via AMM pool\n• **sell** [amount]  — exit long\n• **add liquidity** [usdc]  — earn swap fees\n• **remove liquidity** [lp]  — withdraw LP\n• **price**  — oracle price\n• **balance**  — your wallet`;

// ── Text renderer (bold markdown + newlines) ──────────────────────────────────

function BotText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, li) => {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <span key={li}>
            {parts.map((p, pi) =>
              pi % 2 === 1 ? <strong key={pi}>{p}</strong> : p
            )}
            {li < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

// ── ChatBot ───────────────────────────────────────────────────────────────────

let _id = 1;
const nextId = () => _id++;

export function ChatBot({
  signer, vaultAddress, usdcAddress, synthAddress, poolAddress,
  assetSymbol, oraclePrice, usdcBalance, synthBalance, onSuccess,
}: Props) {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState("");
  const [msgs,    setMsgs]    = useState<Message[]>([
    {
      id: 0, role: "bot",
      text: `Hi! I'm your trading assistant for **${assetSymbol}**.\nType **help** to see what I can do, or just try:\n• "mint 10 USDC"\n• "buy 5 USDC"\n• "sell 0.001 ${assetSymbol}"`,
    },
  ]);
  const [pending, setPending] = useState<ParsedAction | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [unread,  setUnread]  = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [msgs]);

  // Focus input when opened; clear unread
  useEffect(() => {
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function addBot(text: string, extra?: Partial<Message>) {
    const msg: Message = { id: nextId(), role: "bot", text, ...extra };
    setMsgs(prev => [...prev, msg]);
    if (!open) setUnread(n => n + 1);
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs(prev => [...prev, { id: nextId(), role: "user", text }]);

    // ── Info queries ──
    if (/^\bprice\b|\boracle\b/i.test(text)) {
      addBot(`Oracle price: **$${oraclePrice}**`);
      return;
    }
    if (/\bbalance\b|\bwallet\b|\bmy\b/i.test(text)) {
      addBot(
        `Your wallet:\n• USDC: **${parseFloat(usdcBalance).toFixed(4)}**\n• ${assetSymbol}: **${parseFloat(synthBalance).toFixed(6)}**`
      );
      return;
    }
    if (/\bhelp\b|\bcommand\b|\bwhat can\b/i.test(text)) {
      addBot(HELP_TEXT(assetSymbol));
      return;
    }

    // ── Action ──
    const action = parseIntent(text);
    if (!action) {
      addBot(`I didn't quite catch that. Try "mint 10 USDC" or type **help** for all commands.`);
      return;
    }
    if (!signer) {
      addBot(`⚠ Please connect your wallet first.`);
      return;
    }

    const reply = buildReply(action, assetSymbol, oraclePrice);
    setMsgs(prev => [...prev, { id: nextId(), role: "bot", text: reply, action }]);
    setPending(action);
  }

  async function confirm() {
    if (!pending || !signer || busy) return;
    const action = pending;
    setPending(null);
    setBusy(true);
    addBot("⏳ Executing…");

    try {
      let txHash: string | undefined;

      if (action.type === "mint") {
        const usdc  = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
        const vault = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);
        const raw   = BigInt(Math.round(action.amount * 1e6));
        const user  = await signer.getAddress();
        const allow = await usdc.allowance(user, vaultAddress) as bigint;
        if (allow < raw) {
          addBot("🔑 Approving USDC…");
          await (await usdc.approve(vaultAddress, raw) as ethers.ContractTransactionResponse).wait();
        }
        txHash = (await (await vault.mint(raw) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      else if (action.type === "redeem") {
        const vault = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);
        const raw   = ethers.parseEther(String(action.amount));
        txHash = (await (await vault.redeem(raw) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      else if (action.type === "buy") {
        if (!poolAddress) throw new Error("No AMM pool for this market.");
        const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
        const pool = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
        const raw  = BigInt(Math.round(action.amount * 1e6));
        const user = await signer.getAddress();
        const allow = await usdc.allowance(user, poolAddress) as bigint;
        if (allow < raw) {
          addBot("🔑 Approving USDC…");
          await (await usdc.approve(poolAddress, raw) as ethers.ContractTransactionResponse).wait();
        }
        txHash = (await (await pool.swapUsdcForSynth(raw, 0n) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      else if (action.type === "sell") {
        if (!poolAddress) throw new Error("No AMM pool for this market.");
        const synth = new ethers.Contract(synthAddress, ERC20_ABI, signer);
        const pool  = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
        const raw   = ethers.parseEther(String(action.amount));
        const user  = await signer.getAddress();
        const allow = await synth.allowance(user, poolAddress) as bigint;
        if (allow < raw) {
          addBot("🔑 Approving…");
          await (await synth.approve(poolAddress, raw) as ethers.ContractTransactionResponse).wait();
        }
        txHash = (await (await pool.swapSynthForUsdc(raw, 0n) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      else if (action.type === "add-liquidity") {
        if (!poolAddress) throw new Error("No AMM pool for this market.");
        const pool  = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
        const usdc  = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
        const synth = new ethers.Contract(synthAddress, ERC20_ABI, signer);
        const user  = await signer.getAddress();
        const [usdcRes, synthRes] = await pool.getReserves() as [bigint, bigint];
        if (usdcRes === 0n) throw new Error("Pool is empty — seed it via Dev Tools first.");
        const usdcRaw  = BigInt(Math.round(action.amount * 1e6));
        const synthRaw = (usdcRaw * synthRes) / usdcRes;
        addBot("🔑 Approving USDC + synth…");
        const [ua, sa] = await Promise.all([
          usdc.allowance(user, poolAddress)  as Promise<bigint>,
          synth.allowance(user, poolAddress) as Promise<bigint>,
        ]);
        if (ua < usdcRaw)  await (await usdc.approve(poolAddress, usdcRaw)   as ethers.ContractTransactionResponse).wait();
        if (sa < synthRaw) await (await synth.approve(poolAddress, synthRaw) as ethers.ContractTransactionResponse).wait();
        txHash = (await (await pool.addLiquidity(usdcRaw, synthRaw) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      else if (action.type === "remove-liquidity") {
        if (!poolAddress) throw new Error("No AMM pool for this market.");
        const pool = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
        const raw  = ethers.parseEther(String(action.amount));
        txHash = (await (await pool.removeLiquidity(raw) as ethers.ContractTransactionResponse).wait())?.hash;
      }

      addBot("✅ Done!", { txHash });
      onSuccess();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg   = raw.slice(0, 180);
      if (/user rejected|ACTION_REJECTED/i.test(raw)) msg = "Transaction cancelled.";
      else if (/stale/i.test(raw))                    msg = "Oracle price is stale — use Dev Tools → Refresh Oracle.";
      else if (/insufficient/i.test(raw))             msg = "Insufficient balance.";
      else if (/zero reserves/i.test(raw))            msg = "Pool has no liquidity — seed it first.";
      addBot(`❌ ${msg}`, { isError: true });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPending(null);
    addBot("Cancelled. What else can I help with?");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Chat Panel ── */}
      {open && (
        <div style={panelStyle}>
          {/* Header */}
          <div style={headerStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: signer ? "var(--green)" : "var(--gold)",
                boxShadow: `0 0 6px ${signer ? "var(--green)" : "var(--gold)"}`,
              }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                {assetSymbol} Assistant
              </span>
              <span style={{ fontSize: 10, color: "var(--text-4)" }}>
                {signer ? "wallet connected" : "read-only"}
              </span>
            </div>
            <button onClick={() => setOpen(false)} style={closeBtnStyle}>✕</button>
          </div>

          {/* Feed */}
          <div ref={feedRef} style={feedStyle}>
            {msgs.map((m) => (
              <div key={m.id} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 10,
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "9px 13px",
                  borderRadius: m.role === "user"
                    ? "14px 14px 4px 14px"
                    : "14px 14px 14px 4px",
                  background: m.role === "user"
                    ? "var(--accent)"
                    : m.isError
                    ? "rgba(255,80,80,0.1)"
                    : "var(--surface-2)",
                  border: m.role === "user"
                    ? "none"
                    : m.isError
                    ? "1px solid var(--red-border)"
                    : "1px solid var(--border)",
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: m.role === "user" ? "#fff" : m.isError ? "var(--red)" : "var(--text)",
                }}>
                  <BotText text={m.text} />
                  {m.txHash && (
                    <div style={{ marginTop: 6 }}>
                      <a
                        href={`${EXPLORER}/tx/${m.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 10, color: "var(--accent)", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}
                      >
                        {m.txHash.slice(0, 14)}… ↗
                      </a>
                    </div>
                  )}

                  {/* Confirm / Cancel row (only on the last bot message that has a pending action) */}
                  {m.action && pending?.type === m.action.type && !busy && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button onClick={confirm} style={confirmBtn}>
                        ✓ Execute
                      </button>
                      <button onClick={cancel} style={cancelBtn}>
                        ✕ Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>
                <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block", marginRight: 5 }}>↻</span>
                Processing…
              </div>
            )}
          </div>

          {/* Input */}
          <div style={inputRowStyle}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={`Try "mint 10 USDC" or "help"…`}
              disabled={busy}
              style={inputStyle}
            />
            <button onClick={send} disabled={busy || !input.trim()} style={sendBtnStyle}>
              ➤
            </button>
          </div>
        </div>
      )}

      {/* ── Floating bubble ── */}
      <button onClick={() => setOpen(o => !o)} style={bubbleStyle} title="Open trading assistant">
        {open ? "✕" : "💬"}
        {!open && unread > 0 && (
          <span style={badgeStyle}>{unread}</span>
        )}
      </button>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position:     "fixed",
  bottom:       88,
  right:        24,
  width:        340,
  height:       480,
  display:      "flex",
  flexDirection:"column",
  background:   "var(--surface)",
  border:       "1px solid var(--border-2)",
  borderRadius: "var(--radius-xl)",
  boxShadow:    "0 20px 60px rgba(0,0,0,0.6)",
  zIndex:       1000,
  overflow:     "hidden",
  animation:    "slideUp 0.15s ease-out",
};

const headerStyle: React.CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  padding:        "12px 16px",
  borderBottom:   "1px solid var(--border)",
  background:     "var(--surface-2)",
  flexShrink:     0,
};

const feedStyle: React.CSSProperties = {
  flex:       1,
  overflowY:  "auto",
  padding:    "14px 12px",
};

const inputRowStyle: React.CSSProperties = {
  display:    "flex",
  gap:        6,
  padding:    "10px 12px",
  borderTop:  "1px solid var(--border)",
  background: "var(--surface-2)",
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  flex:         1,
  background:   "var(--bg)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color:        "var(--text)",
  padding:      "8px 12px",
  fontSize:     12,
  outline:      "none",
};

const sendBtnStyle: React.CSSProperties = {
  background:   "var(--accent)",
  border:       "none",
  borderRadius: "var(--radius)",
  color:        "#fff",
  padding:      "8px 14px",
  fontSize:     14,
  cursor:       "pointer",
  flexShrink:   0,
};

const closeBtnStyle: React.CSSProperties = {
  background:   "transparent",
  border:       "none",
  color:        "var(--text-4)",
  cursor:       "pointer",
  fontSize:     14,
  lineHeight:   1,
  padding:      "2px 4px",
};

const confirmBtn: React.CSSProperties = {
  flex:         1,
  background:   "var(--accent)",
  border:       "none",
  borderRadius: "var(--radius)",
  color:        "#fff",
  fontSize:     11,
  fontWeight:   700,
  padding:      "6px 0",
  cursor:       "pointer",
};

const cancelBtn: React.CSSProperties = {
  flex:         1,
  background:   "transparent",
  border:       "1px solid var(--border-2)",
  borderRadius: "var(--radius)",
  color:        "var(--text-3)",
  fontSize:     11,
  fontWeight:   600,
  padding:      "6px 0",
  cursor:       "pointer",
};

const bubbleStyle: React.CSSProperties = {
  position:     "fixed",
  bottom:       24,
  right:        24,
  width:        54,
  height:       54,
  borderRadius: "50%",
  background:   "var(--accent)",
  border:       "none",
  boxShadow:    "0 4px 20px rgba(108,99,255,0.5)",
  color:        "#fff",
  fontSize:     22,
  cursor:       "pointer",
  zIndex:       1001,
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
  transition:   "transform 0.15s ease, box-shadow 0.15s ease",
};

const badgeStyle: React.CSSProperties = {
  position:   "absolute",
  top:        -2,
  right:      -2,
  width:      18,
  height:     18,
  borderRadius: "50%",
  background: "var(--red)",
  color:      "#fff",
  fontSize:   10,
  fontWeight: 700,
  display:    "flex",
  alignItems: "center",
  justifyContent: "center",
};
