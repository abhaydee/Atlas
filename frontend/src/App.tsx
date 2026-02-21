import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { WalletConnect }      from "./components/WalletConnect.tsx";
import { MarketInfo }         from "./components/MarketInfo.tsx";
import { MintForm }           from "./components/MintForm.tsx";
import { RedeemForm }         from "./components/RedeemForm.tsx";
import { PoolPanel }          from "./components/PoolPanel.tsx";
import { AgentIdentity }      from "./components/AgentIdentity.tsx";
import { MarketsDashboard, type MarketSummary } from "./components/MarketsDashboard.tsx";
import { ProgressTimeline, type JobRecord }      from "./components/ProgressTimeline.tsx";
import { PriceChart }                            from "./components/PriceChart.tsx";
import { AgentConsole }                          from "./components/AgentConsole.tsx";
import { ChatBot }                              from "./components/ChatBot.tsx";
import { LandingPage }                          from "./components/LandingPage.tsx";
import { Tutorial }                             from "./components/Tutorial.tsx";
import { ERC20_ABI, SYNTHETIC_TOKEN_ABI }        from "./lib/abis.ts";

declare global { interface Window { ethereum?: ethers.Eip1193Provider } }

const BACKEND    = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
const REFRESH_MS = 10_000;
const EXPLORER   = "https://testnet.kitescan.ai";

interface MarketData {
  id: string; assetName: string; assetSymbol: string;
  oraclePrice: string; tvl: string; totalSupply: string; hasSynthPool: boolean;
  excessCollateral?: string; accumulatedFees?: string;
  contracts: {
    syntheticToken: string; oracleReader: string; syntheticVault: string;
    oracleAggregator: string; mockOracle?: string | null; usdc: string; synthPool?: string;
  };
  paymentLog?: { amountHuman: string; agentAddress: string; txHash?: string; status: string; action?: string; timestamp?: string };
}

interface CreateForm { assetName: string; assetSymbol: string; assetDescription: string; totalPayment: string }
type Phase = "idle" | "creating" | "streaming" | "done" | "failed";

// ── Kite Diamond Logo ─────────────────────────────────────────────────────────
function KiteLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 1L31 16L16 31L1 16Z" fill="url(#kite-grad)" />
      <path d="M16 7L25 16L16 25L7 16Z" fill="rgba(0,0,0,0.35)" />
      <circle cx="16" cy="16" r="3" fill="#00C9A7" style={{ filter: "drop-shadow(0 0 4px #00C9A7)" }} />
      <defs>
        <linearGradient id="kite-grad" x1="1" y1="1" x2="31" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E3A5F" />
          <stop offset="50%" stopColor="#243660" />
          <stop offset="100%" stopColor="#00C9A7" stopOpacity="0.8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Toast notification ────────────────────────────────────────────────────────
interface Toast { msg: string; type: "success" | "error" | "info" }

function ToastBar({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  const colors = {
    success: { bg: "var(--green-dim)",  border: "var(--green-border)",  color: "var(--green)",  icon: "✓" },
    error:   { bg: "var(--red-dim)",    border: "var(--red-border)",    color: "var(--red)",    icon: "⚠" },
    info:    { bg: "var(--accent-dim)", border: "var(--accent-border)", color: "var(--accent)", icon: "ℹ" },
  }[toast.type];
  return (
    <div style={{
      position: "fixed", top: 80, right: 24, zIndex: 9999,
      display: "flex", alignItems: "center", gap: 10,
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: "var(--radius-lg)", padding: "12px 18px",
      fontSize: 13, fontWeight: 600, color: colors.color,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      animation: "slideUp 0.2s ease-out",
      maxWidth: 420,
    }}>
      <span style={{ fontSize: 16 }}>{colors.icon}</span>
      <span>{toast.msg}</span>
    </div>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionHeader({ title, bracket, sub }: { title: string; bracket: string; sub: string }) {
  return (
    <div style={{ marginTop: 32, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 3, height: 22, borderRadius: 2, background: "linear-gradient(180deg, var(--accent) 0%, transparent 100%)" }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
          {title}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", opacity: 0.8 }}>
          [ {bracket} ]
        </span>
      </div>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, var(--border-2) 0%, transparent 100%)" }} />
      <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>{sub}</span>
    </div>
  );
}

// ── x402 payment proof card ───────────────────────────────────────────────────
function X402Card({ log }: { log: NonNullable<MarketData["paymentLog"]> }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(0,201,167,0.04) 0%, var(--surface) 100%)",
      border: "1px solid var(--accent-border)",
      borderRadius: "var(--radius-lg)", padding: "14px 18px", marginBottom: 20,
      boxShadow: "0 0 20px rgba(0,201,167,0.05)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>💳</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
              x402 Payment Settlement
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {log.action ?? "market.create"}
              {log.timestamp ? ` · ${new Date(log.timestamp).toLocaleString()}` : ""}
            </div>
          </div>
        </div>
        <span className={`badge ${log.status === "success" ? "badge-green" : "badge-red"}`}>
          {log.status}
        </span>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <X402Stat label="Amount" value={log.amountHuman} accent />
        <X402Stat label="Agent" value={`${log.agentAddress.slice(0,10)}…${log.agentAddress.slice(-6)}`} mono />
        {log.txHash && (
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>On-chain Proof</div>
            <a href={`${EXPLORER}/tx/${log.txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
              {log.txHash.slice(0,14)}… ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function X402Stat({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: accent ? "var(--green)" : "var(--text)", fontFamily: mono ? "JetBrains Mono, monospace" : undefined }}>{value}</div>
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  const hints: Array<[RegExp, string]> = [
    [/insufficient|balance/i, "Top up the agent wallet with testnet USDT at faucet.gokite.ai"],
    [/revoked/i,              "Set AGENT_REVOKED=false in backend .env and restart the server"],
    [/cap|limit/i,            "Daily spend cap reached — wait for UTC midnight reset"],
    [/stale/i,                "Use Dev Tools → Refresh Oracle to push a fresh price on-chain"],
  ];
  const hint = hints.find(([rx]) => rx.test(message))?.[1];
  return (
    <div style={{
      background: "var(--red-dim)", border: "1px solid var(--red-border)",
      borderRadius: "var(--radius)", padding: "12px 16px",
      fontSize: 13, color: "var(--red)", marginBottom: 16, lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700 }}>⚠ {message}</div>
      {hint && <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>→ {hint}</div>}
    </div>
  );
}

// ── Contract address row ──────────────────────────────────────────────────────
function ContractRow({ label, address }: { label: string; address: string }) {
  if (!address) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 6 }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer"
        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", fontSize: 11, textDecoration: "none" }}>
        {address.slice(0,10)}…{address.slice(-8)} ↗
      </a>
    </div>
  );
}

// ── Form field ────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState<"dashboard" | "market" | "create">("dashboard");
  const [showLanding,  setShowLanding]  = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [provider,    setProvider]    = useState<ethers.BrowserProvider | null>(null);
  const [signer,      setSigner]      = useState<ethers.JsonRpcSigner | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<MarketData | null>(null);
  const [marketLoading,  setMarketLoading]  = useState(false);
  const [usdcBalance,    setUsdcBalance]    = useState("0");
  const [synthBalance,   setSynthBalance]   = useState("0");
  const [devPrice,   setDevPrice]   = useState("");
  const [seedAmount, setSeedAmount] = useState("");
  const [devLoading, setDevLoading] = useState(false);
  const [toast, setToast]           = useState<Toast | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    assetName: "Silver", assetSymbol: "sXAG",
    assetDescription: "Spot silver price in USD per troy ounce (XAG/USD).",
    totalPayment: "1",
  });
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastJob,     setLastJob]     = useState<JobRecord | null>(null);
  const [phaseErr,    setPhaseErr]    = useState<string | null>(null);

  function showToast(msg: string, type: Toast["type"]) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }

  // ── Wallet ──────────────────────────────────────────────────────────────────
  async function connectWallet() {
    if (!window.ethereum) { showToast("MetaMask or a Web3 wallet is required.", "error"); return; }
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      const s = await p.getSigner();
      setProvider(p); setSigner(s);
      setUserAddress(await s.getAddress());
    } catch (err) {
      showToast(`Connection failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function disconnectWallet() {
    setProvider(null); setSigner(null); setUserAddress(null);
    setUsdcBalance("0"); setSynthBalance("0");
  }

  // ── Market data ──────────────────────────────────────────────────────────────
  const fetchSelectedMarket = useCallback(async (id: string) => {
    setMarketLoading(true);
    try {
      const res = await fetch(`${BACKEND}/markets/${id}/data`);
      if (!res.ok) return;
      setSelectedMarket(await res.json() as MarketData);
    } catch { /* ignore */ }
    finally { setMarketLoading(false); }
  }, []);

  const fetchBalances = useCallback(async () => {
    if (!provider || !userAddress || !selectedMarket) return;
    try {
      const usdc  = new ethers.Contract(selectedMarket.contracts.usdc,           ERC20_ABI,           provider);
      const synth = new ethers.Contract(selectedMarket.contracts.syntheticToken,  SYNTHETIC_TOKEN_ABI, provider);
      const [uDec, sDec, uBal, sBal] = await Promise.all([
        usdc.decimals() as Promise<bigint>, synth.decimals() as Promise<bigint>,
        usdc.balanceOf(userAddress) as Promise<bigint>, synth.balanceOf(userAddress) as Promise<bigint>,
      ]);
      setUsdcBalance(ethers.formatUnits(uBal, uDec));
      setSynthBalance(ethers.formatUnits(sBal, sDec));
    } catch { /* ignore */ }
  }, [provider, userAddress, selectedMarket]);

  useEffect(() => {
    if (view !== "market" || !selectedMarket) return;
    const id = setInterval(() => {
      void fetchSelectedMarket(selectedMarket.id);
      void fetchBalances();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [view, selectedMarket, fetchSelectedMarket, fetchBalances]);

  useEffect(() => { void fetchBalances(); }, [fetchBalances]);

  // ── Navigation ────────────────────────────────────────────────────────────────
  function goMarket(s: MarketSummary) { setSelectedMarket(null); setView("market"); void fetchSelectedMarket(s.id); }
  function goDash() { setView("dashboard"); setSelectedMarket(null); }
  function goCreate() { setPhase("idle"); setActiveJobId(null); setLastJob(null); setPhaseErr(null); setView("create"); }

  // ── Create market ─────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPhase("creating"); setPhaseErr(null); setActiveJobId(null); setLastJob(null);
    try {
      const res = await fetch(`${BACKEND}/create-market`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...createForm, totalPayment: parseFloat(createForm.totalPayment) || 1 }),
      });
      const data = await res.json() as { success: boolean; jobId?: string; error?: string };
      if (!res.ok || !data.success || !data.jobId) {
        const e = data.error ?? `Server error ${res.status}`;
        if (/insufficient|balance/i.test(e)) throw new Error("Insufficient agent funds. Top up at faucet.gokite.ai");
        if (/revoked/i.test(e))              throw new Error("Agent is revoked. Set AGENT_REVOKED=false in .env");
        if (/cap|limit/i.test(e))            throw new Error("Daily spending cap reached. Wait for UTC midnight reset.");
        throw new Error(e);
      }
      setActiveJobId(data.jobId); setPhase("streaming");
    } catch (err) {
      setPhaseErr(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }

  const handleJobComplete = useCallback((job: JobRecord) => {
    setLastJob(job); setPhase("done");
    setTimeout(() => setView("dashboard"), 2500);
  }, []);
  const handleJobFail = useCallback((error: string) => { setPhaseErr(error); setPhase("failed"); }, []);

  // ── Dev tools ─────────────────────────────────────────────────────────────────
  async function handleSetPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!devPrice || !selectedMarket) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/set-price`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: parseFloat(devPrice) }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!data.success) throw new Error(data.error);
      showToast(`Price set to $${devPrice}`, "success");
      setDevPrice(""); await fetchSelectedMarket(selectedMarket.id);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setDevLoading(false); }
  }

  async function handleUpdateOracle() {
    if (!selectedMarket) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/oracle`, { method: "POST" });
      const data = await res.json() as { success?: boolean; price?: number; source?: string; error?: string };
      if (!data.success) throw new Error(data.error);
      showToast(`Oracle updated: $${data.price?.toFixed(4)} via ${data.source ?? "Pyth"}`, "success");
      await fetchSelectedMarket(selectedMarket.id);
    } catch (err) { showToast(`Oracle failed: ${err instanceof Error ? err.message : String(err)}`, "error"); }
    finally { setDevLoading(false); }
  }

  async function handleSeedPool(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMarket || !seedAmount) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/seed-pool`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usdcAmount: parseFloat(seedAmount) }),
      });
      const data = await res.json() as { success?: boolean; usdcSeeded?: number; synthSeeded?: number; error?: string };
      if (!data.success) throw new Error(/balance|insufficient/i.test(data.error ?? "") ? "Deployer wallet has insufficient USDC." : data.error);
      showToast(`Pool seeded: ${data.usdcSeeded} USDC + ${data.synthSeeded?.toFixed(4)} synth`, "success");
      setSeedAmount(""); await fetchSelectedMarket(selectedMarket.id);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setDevLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const noUsdc = userAddress && parseFloat(usdcBalance) === 0;

  return (
    <>
      {/* ── Landing Page (full-screen overlay, shown on first visit) ── */}
      {showLanding && (
        <LandingPage
          onEnter={() => setShowLanding(false)}
          onTutorial={() => { setShowLanding(false); setShowTutorial(true); }}
        />
      )}

      {/* ── Tutorial overlay (can be triggered from landing or nav) ── */}
      {showTutorial && (
        <Tutorial
          onClose={() => setShowTutorial(false)}
          onEnter={() => { setShowTutorial(false); setShowLanding(false); }}
        />
      )}

      <ToastBar toast={toast} />

      {/* ── Nav ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(8,12,24,0.85)", backdropFilter: "blur(20px) saturate(1.5)",
        borderBottom: "1px solid var(--border)",
        marginBottom: 28,
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {view !== "dashboard" && (
              <button onClick={goDash} style={{ background: "none", border: "1px solid var(--border-2)", borderRadius: "var(--radius)", color: "var(--text-2)", padding: "6px 12px", fontSize: 12, fontWeight: 600, marginRight: 8, cursor: "pointer" }}>
                ← Back
              </button>
            )}
            <KiteLogo size={30} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.5px", lineHeight: 1 }}>
                KITE{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14 }}>[ Synthetic Markets ]</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, fontWeight: 500, letterSpacing: "0.3px" }}>
                Pyth Oracles · x402 Protocol · Kite Testnet
              </div>
            </div>
          </div>

          {/* Nav actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setShowTutorial(true)}
              style={{ background: "transparent", border: "1px solid var(--border-2)", borderRadius: "var(--radius)", color: "var(--text-3)", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Tutorial
            </button>
            {view === "dashboard" && (
              <button onClick={goCreate} className="btn btn-primary btn-sm" style={{ borderRadius: "var(--radius)" }}>
                + New Market
              </button>
            )}
            <WalletConnect address={userAddress} onConnect={connectWallet} onDisconnect={disconnectWallet} />
          </div>
        </div>
      </nav>

      {/* ── Agent identity strip ── */}
      <AgentIdentity backendUrl={BACKEND} />

      {/* ══════════ DASHBOARD ══════════ */}
      {view === "dashboard" && (
        <MarketsDashboard backendUrl={BACKEND} onSelect={goMarket} onCreateNew={goCreate} />
      )}

      {/* ══════════ MARKET VIEW ══════════ */}
      {view === "market" && (
        <>
          {marketLoading && !selectedMarket && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--text-3)" }}>
              <div style={{ fontSize: 28, marginBottom: 12, animation: "spin 1s linear infinite", display: "inline-block" }}>↻</div>
              <div style={{ fontSize: 14 }}>Loading market…</div>
            </div>
          )}

          {selectedMarket && (
            <>
              <MarketInfo
                assetName={selectedMarket.assetName}
                assetSymbol={selectedMarket.assetSymbol}
                oraclePrice={selectedMarket.oraclePrice}
                tvl={selectedMarket.tvl}
                totalSupply={selectedMarket.totalSupply}
                excessCollateral={selectedMarket.excessCollateral ?? "0"}
                accumulatedFees={selectedMarket.accumulatedFees ?? "0"}
                usdcBalance={parseFloat(usdcBalance).toFixed(4)}
                synthBalance={parseFloat(synthBalance).toFixed(6)}
                collateral="100%"
                loading={marketLoading}
              />

              <PriceChart marketId={selectedMarket.id} assetSymbol={selectedMarket.assetSymbol} backendUrl={BACKEND} />

              {selectedMarket.paymentLog && <X402Card log={selectedMarket.paymentLog} />}

              {/* Notices */}
              {!userAddress && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "14px 18px", marginBottom: 20,
                  background: "var(--surface)", border: "1px dashed var(--border-2)",
                  borderRadius: "var(--radius-lg)", fontSize: 13, color: "var(--text-3)",
                  flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>🔗</span>
                    <span>Connect your wallet to trade manually</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block", boxShadow: "0 0 6px var(--accent)", animation: "glow-pulse 2s infinite" }} />
                    AI agents are trading autonomously below ↓
                  </div>
                </div>
              )}

              {noUsdc && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "14px 18px", marginBottom: 20,
                  background: "var(--gold-dim)", border: "1px solid var(--gold-border)",
                  borderRadius: "var(--radius-lg)", fontSize: 13, color: "var(--text)",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
                  <div>
                    <strong style={{ color: "var(--gold)" }}>No testnet USDC in your wallet.</strong>
                    {" "}Get some from the{" "}
                    <a href="https://faucet.gokite.ai/" target="_blank" rel="noopener noreferrer"
                      style={{ color: "var(--gold)", fontWeight: 700, textDecoration: "none" }}>Kite faucet ↗</a>
                    {" "}— Approve &amp; Mint will fail without it.
                  </div>
                </div>
              )}

              {/* Vault */}
              <SectionHeader title="Vault" bracket="Short Exposure"
                sub={`Deposit USDC → issue ${selectedMarket.assetSymbol} · profit if price falls`} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <MintForm
                  vaultAddress={selectedMarket.contracts.syntheticVault}
                  usdcAddress={selectedMarket.contracts.usdc}
                  oraclePrice={selectedMarket.oraclePrice}
                  assetSymbol={selectedMarket.assetSymbol}
                  signer={signer}
                  onSuccess={() => { void fetchSelectedMarket(selectedMarket.id); void fetchBalances(); }}
                />
                <RedeemForm
                  vaultAddress={selectedMarket.contracts.syntheticVault}
                  oraclePrice={selectedMarket.oraclePrice}
                  assetSymbol={selectedMarket.assetSymbol}
                  signer={signer}
                  onSuccess={() => { void fetchSelectedMarket(selectedMarket.id); void fetchBalances(); }}
                />
              </div>

              {/* AI Agent Console */}
              <AgentConsole
                backendUrl={BACKEND}
                marketId={selectedMarket.id}
                assetSymbol={selectedMarket.assetSymbol}
              />

              {/* AMM Pool */}
              {selectedMarket.contracts.synthPool && (
                <>
                  <SectionHeader title="AMM Pool" bracket="Long Exposure"
                    sub={`Swap USDC ↔ ${selectedMarket.assetSymbol} · earn 1% fees as LP`} />
                  <PoolPanel
                    poolAddress={selectedMarket.contracts.synthPool}
                    usdcAddress={selectedMarket.contracts.usdc}
                    synthAddress={selectedMarket.contracts.syntheticToken}
                    assetSymbol={selectedMarket.assetSymbol}
                    oraclePrice={selectedMarket.oraclePrice}
                    signer={signer}
                    userAddress={userAddress}
                    backendUrl={BACKEND}
                    marketId={selectedMarket.id}
                    onSuccess={() => { void fetchSelectedMarket(selectedMarket.id); void fetchBalances(); }}
                  />
                </>
              )}

              {/* Dev Tools */}
              {selectedMarket.contracts.oracleAggregator && (
                <details style={{ marginTop: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                  <summary style={{ cursor: "pointer", padding: "12px 18px", fontSize: 12, fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.4px", textTransform: "uppercase" }}>
                    ⚙ Dev Tools — Oracle &amp; Pool Bootstrap
                  </summary>
                  <div style={{ padding: "0 18px 18px", borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>

                    <div style={{ padding: "10px 14px", background: "var(--surface-2)", border: "1px solid var(--gold-border)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--gold)", display: "flex", gap: 10 }}>
                      <span>⏱</span>
                      <span>On-chain oracle has a <strong>2-hour staleness threshold</strong>. If stale, all transactions revert. Use Refresh below.</span>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Refresh Oracle (Pyth)</div>
                      <button onClick={() => void handleUpdateOracle()} disabled={devLoading} className="btn btn-ghost btn-sm">
                        {devLoading ? <><Spinner />Updating…</> : "↻ Refresh from Pyth"}
                      </button>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Manual Price Override</div>
                      <form onSubmit={(e) => void handleSetPrice(e)} style={{ display: "flex", gap: 8 }}>
                        <input type="number" step="any" min="0" placeholder="USD price" value={devPrice}
                          onChange={(e) => setDevPrice(e.target.value)} className="field-input" style={{ flex: 1 }} />
                        <button type="submit" disabled={devLoading || !devPrice} className="btn btn-ghost btn-sm">Set</button>
                      </form>
                    </div>

                    {selectedMarket.contracts.synthPool && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Seed Pool Liquidity</div>
                        <form onSubmit={(e) => void handleSeedPool(e)} style={{ display: "flex", gap: 8 }}>
                          <input type="number" step="any" min="0" placeholder="USDC amount (e.g. 20)" value={seedAmount}
                            onChange={(e) => setSeedAmount(e.target.value)} className="field-input" style={{ flex: 1 }} />
                          <button type="submit" disabled={devLoading || !seedAmount} className="btn btn-sm"
                            style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)", borderRadius: "var(--radius)" }}>
                            {devLoading ? <Spinner /> : "Seed"}
                          </button>
                        </form>
                      </div>
                    )}

                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════ CREATE ══════════ */}
      {view === "create" && (
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          {/* Hero */}
          <div style={{
            background: "linear-gradient(135deg, var(--surface) 0%, rgba(0,201,167,0.05) 100%)",
            border: "1px solid var(--border-2)", borderRadius: "var(--radius-xl)",
            padding: "32px 36px", marginBottom: 24, boxShadow: "var(--shadow-card)",
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.5px", marginBottom: 8 }}>
                Create <span style={{ color: "var(--accent)" }}>[ Synthetic Market ]</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>
                The autonomous agent pays the x402 fee, researches Pyth oracle feeds,
                and deploys all contracts on Kite Testnet — fully autonomous, no wallet needed.
              </p>
            </div>

            {/* Flow */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 24, padding: "14px 16px", background: "var(--surface-2)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)" }}>
              {[["💳","x402 Payment"],["🔍","AI Research"],["📜","Deploy Contracts"],["🔮","Oracle Init"],["💧","Seed Liquidity"],["🤖","Spawn Agents"]].map(([icon, step], i, arr) => (
                <React.Fragment key={step}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-3)", border: "1px solid var(--border-2)", borderRadius: "var(--radius)", padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                    <span>{icon}</span><span>{step}</span>
                  </div>
                  {i < arr.length - 1 && <span style={{ color: "var(--text-4)", fontSize: 16 }}>→</span>}
                </React.Fragment>
              ))}
            </div>

            {/* x402 scope pills */}
            <div style={{ padding: "12px 14px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "var(--radius-lg)", marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>x402 Payment Details</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["Scope","market.create"],["Network","Kite Testnet"],["Token","USDT"],["Per-req cap","$10"],["Daily cap","$50"]].map(([l,v]) => (
                  <div key={l} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}>
                    <span style={{ color: "var(--text-3)" }}>{l}:</span>
                    <span style={{ color: "var(--text)", fontWeight: 600, background: "var(--surface-2)", padding: "1px 7px", borderRadius: 20, border: "1px solid var(--border-2)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress */}
            {(phase === "streaming" || phase === "done" || (phase === "failed" && activeJobId)) && activeJobId && (
              <ProgressTimeline jobId={activeJobId} backendUrl={BACKEND} onComplete={handleJobComplete} onFail={handleJobFail} />
            )}

            {/* Success */}
            {phase === "done" && lastJob?.market && (
              <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "var(--radius-lg)", padding: "16px 20px", marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>✓ Market deployed — returning to dashboard…</div>
                <ContractRow label="Vault"  address={lastJob.market.contracts.syntheticVault} />
                <ContractRow label="Token"  address={lastJob.market.contracts.syntheticToken} />
                <ContractRow label="Oracle" address={lastJob.market.contracts.oracleAggregator} />
              </div>
            )}

            {phaseErr && <ErrorBanner message={phaseErr} />}

            {/* Form */}
            {(phase === "idle" || phase === "failed") && (
              <form onSubmit={(e) => void handleCreate(e)}>
                <Field label="Asset Name"        value={createForm.assetName}        onChange={(v) => setCreateForm((f) => ({ ...f, assetName: v }))}        placeholder="Gold, Bitcoin, Silver, Oil…" />
                <Field label="Token Symbol"       value={createForm.assetSymbol}      onChange={(v) => setCreateForm((f) => ({ ...f, assetSymbol: v }))}      placeholder="sGLD, sBTC, sXAG…" />
                <Field label="Description"        value={createForm.assetDescription} onChange={(v) => setCreateForm((f) => ({ ...f, assetDescription: v }))} placeholder="Describe the real-world asset…" />
                <Field label="Agent Fee (USDT)" type="number" value={createForm.totalPayment} onChange={(v) => setCreateForm((f) => ({ ...f, totalPayment: v }))} hint="Paid autonomously via x402 — no wallet confirmation required" />

                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                  <span>🤖</span> Agent pays autonomously via x402 — you don&apos;t sign anything
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: "100%", borderRadius: "var(--radius)", padding: "13px", fontSize: 15, fontWeight: 800 }}>
                  Deploy Market Autonomously
                </button>
              </form>
            )}

            {phase === "streaming" && (
              <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 13, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Spinner /> Agent executing — usually 1–3 minutes
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Floating ChatBot — visible on the market view ── */}
      {view === "market" && selectedMarket && (
        <ChatBot
          signer={signer}
          vaultAddress={selectedMarket.contracts.syntheticVault}
          usdcAddress={selectedMarket.contracts.usdc}
          synthAddress={selectedMarket.contracts.syntheticToken}
          poolAddress={selectedMarket.contracts.synthPool ?? ""}
          assetSymbol={selectedMarket.assetSymbol}
          oraclePrice={selectedMarket.oraclePrice}
          usdcBalance={usdcBalance}
          synthBalance={synthBalance}
          onSuccess={() => { void fetchSelectedMarket(selectedMarket.id); void fetchBalances(); }}
        />
      )}
    </>
  );
}

function Spinner() {
  return <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block", fontSize: 14 }}>↻</span>;
}
