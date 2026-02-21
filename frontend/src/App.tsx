/**
 * Kite [ Synthetic Markets ] — Multi-Market App
 *
 * Views:
 *   "dashboard"  — grid of all live markets + Create New Market button
 *   "market"     — trading view for a selected market (mint/redeem/swap)
 *   "create"     — autonomous market creation form + progress timeline
 */

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
import { ERC20_ABI, SYNTHETIC_TOKEN_ABI }        from "./lib/abis.ts";

declare global {
  interface Window { ethereum?: ethers.Eip1193Provider; }
}

const BACKEND    = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
const REFRESH_MS = 10_000;
const KITE_EXPLORER = "https://testnet.kitescan.ai";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketData {
  id:           string;
  assetName:    string;
  assetSymbol:  string;
  oraclePrice:  string;
  tvl:          string;
  totalSupply:  string;
  hasSynthPool: boolean;
  contracts: {
    syntheticToken:   string;
    oracleReader:     string;
    syntheticVault:   string;
    oracleAggregator: string;
    mockOracle?:      string | null;
    usdc:             string;
    synthPool?:       string;
  };
  paymentLog?: {
    amountHuman:  string;
    agentAddress: string;
    txHash?:      string;
    status:       string;
    action?:      string;
    timestamp?:   string;
  };
}

interface CreateForm {
  assetName:        string;
  assetSymbol:      string;
  assetDescription: string;
  totalPayment:     string;
}

type Phase = "idle" | "creating" | "streaming" | "done" | "failed";

// ── Kite Logo SVG ─────────────────────────────────────────────────────────────

function KiteLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2L30 16L16 30L2 16Z" fill="#1C1C1E" />
      <path d="M16 8L24 16L16 24L8 16Z" fill="#C8963A" />
      <circle cx="16" cy="16" r="2.5" fill="#FFFFFF" />
    </svg>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<"dashboard" | "market" | "create">("dashboard");

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

  const [createForm, setCreateForm] = useState<CreateForm>({
    assetName:        "Silver",
    assetSymbol:      "sXAG",
    assetDescription: "Spot silver price in USD per troy ounce (XAG/USD).",
    totalPayment:     "1",
  });
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastJob,     setLastJob]     = useState<JobRecord | null>(null);
  const [phaseErr,    setPhaseErr]    = useState<string | null>(null);

  // Oracle update notification state
  const [oracleNotif, setOracleNotif] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // ── Wallet ──────────────────────────────────────────────────────────────────

  async function connectWallet() {
    if (!window.ethereum) {
      showOracleNotif("MetaMask or a Web3 wallet is required to trade.", "error");
      return;
    }
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      const s = await p.getSigner();
      setProvider(p); setSigner(s);
      setUserAddress(await s.getAddress());
    } catch (err) {
      showOracleNotif(`Wallet connection failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function disconnectWallet() {
    setProvider(null); setSigner(null); setUserAddress(null);
    setUsdcBalance("0"); setSynthBalance("0");
  }

  function showOracleNotif(msg: string, type: "success" | "error") {
    setOracleNotif({ msg, type });
    setTimeout(() => setOracleNotif(null), 5000);
  }

  // ── Load a market's live data ────────────────────────────────────────────────

  const fetchSelectedMarket = useCallback(async (id: string) => {
    setMarketLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${id}/data`);
      if (!res.ok) return;
      const data = await res.json() as MarketData;
      setSelectedMarket(data);
    } catch { /* ignore */ }
    finally { setMarketLoading(false); }
  }, []);

  const fetchBalances = useCallback(async () => {
    if (!provider || !userAddress || !selectedMarket) return;
    try {
      const usdc  = new ethers.Contract(selectedMarket.contracts.usdc,           ERC20_ABI,           provider);
      const synth = new ethers.Contract(selectedMarket.contracts.syntheticToken,  SYNTHETIC_TOKEN_ABI, provider);
      const [uDec, sDec, uBal, sBal] = await Promise.all([
        usdc.decimals()              as Promise<bigint>,
        synth.decimals()             as Promise<bigint>,
        usdc.balanceOf(userAddress)  as Promise<bigint>,
        synth.balanceOf(userAddress) as Promise<bigint>,
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

  // ── Navigation ───────────────────────────────────────────────────────────────

  function handleSelectMarket(summary: MarketSummary) {
    setSelectedMarket(null);
    setView("market");
    void fetchSelectedMarket(summary.id);
  }

  function handleGoToDashboard() {
    setView("dashboard");
    setSelectedMarket(null);
    setOracleNotif(null);
  }

  function handleGoToCreate() {
    setPhase("idle");
    setActiveJobId(null);
    setLastJob(null);
    setPhaseErr(null);
    setView("create");
  }

  // ── Create market — autonomous ────────────────────────────────────────────────

  async function handleCreateMarket(e: React.FormEvent) {
    e.preventDefault();
    setPhase("creating");
    setPhaseErr(null);
    setActiveJobId(null);
    setLastJob(null);

    try {
      const res = await fetch(`${BACKEND}/create-market`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName:        createForm.assetName,
          assetSymbol:      createForm.assetSymbol,
          assetDescription: createForm.assetDescription,
          totalPayment:     parseFloat(createForm.totalPayment) || 1,
        }),
      });
      const data = await res.json() as { success: boolean; jobId?: string; error?: string };

      if (!res.ok || !data.success || !data.jobId) {
        const errMsg = data.error ?? `Server error ${res.status}`;
        // Map specific errors to friendly messages
        if (errMsg.includes("insufficient") || errMsg.includes("balance")) {
          throw new Error("Insufficient agent funds. Top up the agent wallet with testnet USDT before creating markets.");
        } else if (errMsg.includes("revoked")) {
          throw new Error("Agent is revoked. Set AGENT_REVOKED=false in the backend .env to re-enable.");
        } else if (errMsg.includes("cap") || errMsg.includes("limit")) {
          throw new Error("Daily spending cap reached. The agent cannot make more x402 payments until the cap resets.");
        }
        throw new Error(errMsg);
      }

      setActiveJobId(data.jobId);
      setPhase("streaming");
    } catch (err) {
      setPhaseErr(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }

  const handleJobComplete = useCallback((job: JobRecord) => {
    setLastJob(job);
    setPhase("done");
    setTimeout(() => setView("dashboard"), 2500);
  }, []);

  const handleJobFail = useCallback((error: string) => {
    setPhaseErr(error); setPhase("failed");
  }, []);

  // ── Dev tools ────────────────────────────────────────────────────────────────

  async function handleSetPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!devPrice || !selectedMarket) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/set-price`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ price: parseFloat(devPrice) }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!data.success) throw new Error(data.error);
      await fetchSelectedMarket(selectedMarket.id);
      setDevPrice("");
      showOracleNotif(`Price manually set to $${devPrice}`, "success");
    } catch (err) {
      showOracleNotif(err instanceof Error ? err.message : String(err), "error");
    }
    finally { setDevLoading(false); }
  }

  async function handleUpdateOracle() {
    if (!selectedMarket) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/oracle`, { method: "POST" });
      const data = await res.json() as { success?: boolean; price?: number; source?: string; error?: string };
      if (!data.success) {
        const errMsg = data.error ?? "Oracle update failed";
        if (errMsg.includes("feed") || errMsg.includes("pyth")) {
          throw new Error("Could not find a Pyth feed for this asset. Try setting a manual price.");
        }
        throw new Error(errMsg);
      }
      showOracleNotif(`Oracle updated: $${data.price?.toFixed(4)} via ${data.source ?? "Pyth"}`, "success");
      await fetchSelectedMarket(selectedMarket.id);
    } catch (err) {
      showOracleNotif(`Oracle update failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
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
      const data = await res.json() as { success?: boolean; usdcSeeded?: number; synthSeeded?: number; txHash?: string; error?: string };
      if (!data.success) {
        const errMsg = data.error ?? "Seed failed";
        if (errMsg.includes("balance") || errMsg.includes("insufficient")) {
          throw new Error("Deployer wallet has insufficient USDC to seed the pool.");
        }
        throw new Error(errMsg);
      }
      showOracleNotif(`Pool seeded: ${data.usdcSeeded} USDC + ${data.synthSeeded?.toFixed(4)} synth`, "success");
      setSeedAmount("");
      await fetchSelectedMarket(selectedMarket.id);
    } catch (err) {
      showOracleNotif(`Seed failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    finally { setDevLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasNoUsdc = userAddress && parseFloat(usdcBalance) === 0;

  return (
    <div>
      {/* ── Top Nav ── */}
      <nav style={navStyle}>
        <div style={navInner}>
          {/* Logo + Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <KiteLogo />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: "var(--text)", letterSpacing: "-0.3px", lineHeight: 1 }}>
                Kite{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>[</span>
                {" "}Synthetic Markets{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>]</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontWeight: 500 }}>
                Kite L1 Testnet · Pyth Oracles · x402
              </div>
            </div>
          </div>

          {/* Nav links + wallet */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {view !== "dashboard" && (
              <button onClick={handleGoToDashboard} style={navBtn}>
                ← Markets
              </button>
            )}
            {view === "dashboard" && (
              <button onClick={handleGoToCreate} style={navBtnPrimary}>
                + Create Market
              </button>
            )}
            <WalletConnect address={userAddress} onConnect={connectWallet} onDisconnect={disconnectWallet} />
          </div>
        </div>
      </nav>

      {/* ── Notification Toast ── */}
      {oracleNotif && (
        <div style={{
          ...toastStyle,
          background:   oracleNotif.type === "success" ? "var(--green-light)" : "var(--red-light)",
          borderColor:  oracleNotif.type === "success" ? "var(--green)"       : "var(--red)",
          color:        oracleNotif.type === "success" ? "var(--green)"       : "var(--red)",
        }}>
          {oracleNotif.type === "success" ? "✓" : "⚠"} {oracleNotif.msg}
        </div>
      )}

      {/* ── Agent Identity ── */}
      <AgentIdentity backendUrl={BACKEND} />

      {/* ── Dashboard ── */}
      {view === "dashboard" && (
        <MarketsDashboard
          backendUrl={BACKEND}
          onSelect={handleSelectMarket}
          onCreateNew={handleGoToCreate}
        />
      )}

      {/* ── Trading view ── */}
      {view === "market" && (
        <>
          {marketLoading && !selectedMarket && (
            <div style={loadingCenter}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 8, fontSize: 18 }}>↻</span>
              Loading market data…
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
                usdcBalance={parseFloat(usdcBalance).toFixed(4)}
                synthBalance={parseFloat(synthBalance).toFixed(6)}
                collateral="100%"
                loading={marketLoading}
              />

              {/* Price chart */}
              <PriceChart
                marketId={selectedMarket.id}
                assetSymbol={selectedMarket.assetSymbol}
                backendUrl={BACKEND}
              />

              {/* x402 Payment Proof — prominent card */}
              {selectedMarket.paymentLog && (
                <X402PaymentCard log={selectedMarket.paymentLog} />
              )}

              {/* Wallet / USDC notices */}
              {!userAddress && (
                <div style={noticeBanner}>
                  <span style={{ fontSize: 16 }}>🔗</span>
                  Connect your wallet above to start trading.
                </div>
              )}

              {hasNoUsdc && (
                <div style={warningBanner}>
                  <span style={{ fontSize: 16 }}>⚠</span>
                  <div>
                    <strong>No testnet USDC detected.</strong>{" "}
                    Get some from the{" "}
                    <a href="https://faucet.gokite.ai/" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      Kite faucet ↗
                    </a>
                    {" "}then refresh — approve &amp; mint will fail without USDC.
                  </div>
                </div>
              )}

              {/* ── Vault Section ── */}
              <SectionHeader
                title="Vault"
                bracket="Short Exposure"
                sub={`Deposit USDC → issue ${selectedMarket.assetSymbol} debt. Profit if oracle price falls.`}
              />
              <div style={cols}>
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

              {/* ── AMM Pool Section ── */}
              {selectedMarket.contracts.synthPool && (
                <>
                  <SectionHeader
                    title="AMM Pool"
                    bracket="Long Exposure"
                    sub={`Swap USDC ↔ ${selectedMarket.assetSymbol} to go long. Earn 1% fees as LP.`}
                  />
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

              {/* ── Dev Tools ── */}
              {selectedMarket.contracts.oracleAggregator && (
                <details style={devDetails}>
                  <summary style={devSummary}>
                    <span style={{ color: "var(--accent)", fontWeight: 700 }}>[ </span>
                    Dev Tools
                    <span style={{ color: "var(--accent)", fontWeight: 700 }}> ]</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>Oracle &amp; Pool bootstrap</span>
                  </summary>

                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Oracle staleness warning */}
                    <div style={devInfoBox}>
                      <span style={{ fontSize: 15 }}>⏱</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-2)" }}>Oracle Staleness</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          The on-chain oracle has a <strong>2-hour staleness threshold</strong>. If the price hasn&apos;t been
                          updated within 2h, mint/redeem/swap transactions will revert. Use &quot;Refresh Oracle&quot; below.
                        </div>
                      </div>
                    </div>

                    {/* Oracle refresh */}
                    <DevRow label="Refresh Oracle (Pyth)" hint="Fetches latest price from Pyth Network and writes it on-chain">
                      <button type="button" onClick={() => void handleUpdateOracle()} disabled={devLoading} style={btnSm}>
                        {devLoading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span> Updating…</> : "Refresh Oracle"}
                      </button>
                    </DevRow>

                    {/* Manual price override */}
                    <DevRow label="Manual Price Override" hint="Directly set the oracle price — dev/testing only">
                      <form onSubmit={(e) => void handleSetPrice(e)} style={{ display: "flex", gap: 8 }}>
                        <input
                          type="number" step="any" min="0"
                          placeholder="Price in USD"
                          value={devPrice}
                          onChange={(e) => setDevPrice(e.target.value)}
                          style={{ ...inputSm, flex: 1 }}
                        />
                        <button type="submit" disabled={devLoading || !devPrice} style={btnSm}>
                          {devLoading ? "…" : "Set Price"}
                        </button>
                      </form>
                    </DevRow>

                    {/* Seed pool */}
                    {selectedMarket.contracts.synthPool && (
                      <DevRow label="Seed Pool" hint="Bootstrap initial liquidity from the deployer wallet (USDC + synth)">
                        <form onSubmit={(e) => void handleSeedPool(e)} style={{ display: "flex", gap: 8 }}>
                          <input
                            type="number" step="any" min="0"
                            placeholder="USDC amount (e.g. 20)"
                            value={seedAmount}
                            onChange={(e) => setSeedAmount(e.target.value)}
                            style={{ ...inputSm, flex: 1 }}
                          />
                          <button type="submit" disabled={devLoading || !seedAmount} style={{ ...btnSm, background: "var(--green)", borderColor: "var(--green)" }}>
                            {devLoading ? "Seeding…" : "Seed Pool"}
                          </button>
                        </form>
                      </DevRow>
                    )}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      {/* ── Create Market ── */}
      {view === "create" && (
        <div style={createCard}>
          {/* Title */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
              Create{" "}
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>[</span>
              {" "}Synthetic Market{" "}
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>]</span>
            </h2>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              The autonomous agent pays the x402 fee from its own wallet, researches data sources,
              and deploys all contracts on Kite Testnet — no wallet confirmation required from you.
            </p>
          </div>

          {/* Flow diagram */}
          <div style={flowDiagram}>
            {[
              { step: "x402 Payment",    icon: "💳" },
              { step: "AI Research",     icon: "🔍" },
              { step: "Deploy Contracts",icon: "📜" },
              { step: "Oracle Init",     icon: "🔮" },
            ].map(({ step, icon }, i, arr) => (
              <React.Fragment key={step}>
                <div style={flowStep}>
                  <span>{icon}</span>
                  <span>{step}</span>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ color: "var(--border-hover)", fontSize: 18, fontWeight: 300 }}>→</div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* x402 explanation */}
          <div style={x402InfoBox}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "var(--accent)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              x402 Payment Protocol
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
              Each market creation triggers an <strong>HTTP 402 payment</strong> from the agent&apos;s dedicated wallet.
              The payment is settled on-chain on Kite Testnet before any AI research or contract deployment begins.
              Every payment is cryptographically signed and verifiable via the transaction hash shown below.
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <X402Pill label="Scope" value="market.create" />
              <X402Pill label="Network" value="Kite Testnet" />
              <X402Pill label="Token" value="USDT" />
              <X402Pill label="Per-request cap" value="$10" />
              <X402Pill label="Daily cap" value="$50" />
            </div>
          </div>

          {/* Progress timeline */}
          {(phase === "streaming" || phase === "done" || (phase === "failed" && activeJobId)) && activeJobId && (
            <ProgressTimeline
              jobId={activeJobId}
              backendUrl={BACKEND}
              onComplete={handleJobComplete}
              onFail={handleJobFail}
            />
          )}

          {/* Success */}
          {phase === "done" && lastJob?.market && (
            <div style={successBox}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>
                ✓ Market deployed — returning to dashboard…
              </div>
              <ContractRow label="Vault"  address={lastJob.market.contracts.syntheticVault} />
              <ContractRow label="Token"  address={lastJob.market.contracts.syntheticToken} />
              <ContractRow label="Oracle" address={lastJob.market.contracts.oracleAggregator} />
            </div>
          )}

          {/* Error */}
          {phaseErr && <ErrorBanner message={phaseErr} />}

          {/* Form */}
          {(phase === "idle" || phase === "failed") && (
            <form onSubmit={(e) => void handleCreateMarket(e)} style={{ marginTop: 20 }}>
              <Field label="Asset Name" value={createForm.assetName}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetName: v }))}
                placeholder="Gold, Bitcoin, Silver, Oil Index…" />
              <Field label="Token Symbol" value={createForm.assetSymbol}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetSymbol: v }))}
                placeholder="sGLD, sBTC, sXAG…" />
              <Field label="Description" value={createForm.assetDescription}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetDescription: v }))}
                placeholder="Describe the real-world asset…" />
              <Field label="Agent Fee (USDT — paid autonomously via x402)" type="number"
                value={createForm.totalPayment}
                onChange={(v) => setCreateForm((f) => ({ ...f, totalPayment: v }))}
                placeholder="1" />

              <div style={agentNote}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span>No wallet needed — agent signs and pays autonomously via x402.</span>
              </div>

              <button type="submit" style={btnPrimary}>
                Deploy Market Autonomously
              </button>
            </form>
          )}

          {phase === "streaming" && (
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 6 }}>↻</span>
              Agent is executing autonomously — usually takes 1–3 minutes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── X402 Payment Card ─────────────────────────────────────────────────────────

function X402PaymentCard({ log }: {
  log: {
    amountHuman: string;
    agentAddress: string;
    txHash?: string;
    status: string;
    action?: string;
    timestamp?: string;
  };
}) {
  return (
    <div style={x402Card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={x402Icon}>💳</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              x402 Payment Settlement
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              {log.action ?? "market.create"} · {log.timestamp ? new Date(log.timestamp).toLocaleString() : ""}
            </div>
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          background: log.status === "success" ? "var(--green-light)" : "var(--red-light)",
          color:      log.status === "success" ? "var(--green)"       : "var(--red)",
          border:     `1px solid ${log.status === "success" ? "var(--green)" : "var(--red)"}`,
        }}>
          {log.status.toUpperCase()}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <X402Detail label="Amount"       value={log.amountHuman} highlight />
        <X402Detail label="Agent Wallet" value={`${log.agentAddress.slice(0, 10)}…${log.agentAddress.slice(-6)}`} mono />
        {log.txHash && (
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>On-chain Proof</div>
            <a
              href={`${KITE_EXPLORER}/tx/${log.txHash}`}
              target="_blank" rel="noreferrer"
              style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
            >
              {log.txHash.slice(0, 14)}… ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function X402Detail({ label, value, highlight = false, mono = false }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: highlight ? 700 : 500, color: highlight ? "var(--green)" : "var(--text)", fontFamily: mono ? "monospace" : undefined }}>
        {value}
      </div>
    </div>
  );
}

function X402Pill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}:</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 20 }}>
        {value}
      </span>
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ title, bracket, sub }: { title: string; bracket: string; sub: string }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 3, height: 20, background: "var(--accent)", borderRadius: 2 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
          {title}{" "}
          <span style={{ color: "var(--accent)" }}>[</span>
          {" "}{bracket}{" "}
          <span style={{ color: "var(--accent)" }}>]</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginLeft: 13 }}>{sub}</div>
    </div>
  );
}

// ── Error Banner ──────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  // Provide action hints for known errors
  let hint = "";
  if (message.includes("insufficient") || message.includes("Insufficient")) {
    hint = "Action: Top up the agent wallet with testnet USDT at faucet.gokite.ai";
  } else if (message.includes("revoked") || message.includes("Revoked")) {
    hint = "Action: Set AGENT_REVOKED=false in backend .env and restart the server.";
  } else if (message.includes("cap") || message.includes("limit")) {
    hint = "Action: Wait for the daily cap to reset (UTC midnight) or increase AGENT_DAILY_CAP in .env.";
  } else if (message.includes("stale") || message.includes("Stale")) {
    hint = "Action: Use Dev Tools → Refresh Oracle to push a fresh price on-chain.";
  }

  return (
    <div style={errorBox}>
      <div style={{ fontWeight: 700, marginBottom: hint ? 6 : 0 }}>⚠ {message}</div>
      {hint && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── Dev Tools Row ─────────────────────────────────────────────────────────────

function DevRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{hint}</div>
      {children}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "10px 14px", fontSize: 14, boxSizing: "border-box" }}
      />
    </div>
  );
}

function ContractRow({ label, address }: { label: string; address: string }) {
  if (!address) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5, alignItems: "center" }}>
      <span style={{ color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <a href={`${KITE_EXPLORER}/address/${address}`} target="_blank" rel="noreferrer"
        style={{ fontFamily: "monospace", color: "var(--accent)", fontSize: 11, textDecoration: "none", fontWeight: 600 }}>
        {address.slice(0, 10)}…{address.slice(-8)} ↗
      </a>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const navStyle: React.CSSProperties = {
  position:     "sticky",
  top:          0,
  zIndex:       100,
  background:   "rgba(245, 242, 234, 0.92)",
  backdropFilter: "blur(12px)",
  borderBottom: "1px solid var(--border)",
  marginBottom: 24,
};

const navInner: React.CSSProperties = {
  maxWidth:       1040,
  margin:         "0 auto",
  padding:        "14px 20px",
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
};

const navBtn: React.CSSProperties = {
  background:   "transparent",
  color:        "var(--muted)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "7px 14px",
  fontSize:     13,
  fontWeight:   500,
  cursor:       "pointer",
  transition:   "all 0.15s",
};

const navBtnPrimary: React.CSSProperties = {
  background:   "var(--cta)",
  color:        "#FFFFFF",
  border:       "none",
  borderRadius: "var(--radius)",
  padding:      "8px 18px",
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
};

const cols: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "1fr 1fr",
  gap:                 16,
};

const loadingCenter: React.CSSProperties = {
  textAlign:  "center",
  padding:    "60px 20px",
  color:      "var(--muted)",
  fontSize:   14,
  fontWeight: 500,
};

const toastStyle: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          8,
  padding:      "12px 16px",
  borderRadius: "var(--radius)",
  border:       "1px solid",
  fontSize:     13,
  fontWeight:   600,
  marginBottom: 16,
  animation:    "slideIn 0.2s ease-out",
};

const noticeBanner: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          10,
  fontSize:     13,
  color:        "var(--muted)",
  textAlign:    "center" as const,
  justifyContent: "center",
  padding:      "12px 16px",
  marginBottom: 16,
  background:   "var(--surface)",
  border:       "1px dashed var(--border)",
  borderRadius: "var(--radius)",
};

const warningBanner: React.CSSProperties = {
  display:      "flex",
  alignItems:   "flex-start",
  gap:          10,
  fontSize:     13,
  background:   "rgba(200,150,58,0.08)",
  border:       "1px solid rgba(200,150,58,0.35)",
  borderRadius: "var(--radius)",
  padding:      "12px 16px",
  marginBottom: 16,
  color:        "var(--text)",
  lineHeight:   1.5,
};

const linkStyle: React.CSSProperties = {
  color:          "var(--accent)",
  fontWeight:     700,
  textDecoration: "none",
};

const x402Card: React.CSSProperties = {
  background:   "rgba(42,125,82,0.05)",
  border:       "1px solid rgba(42,125,82,0.25)",
  borderRadius: "var(--radius)",
  padding:      "14px 18px",
  marginBottom: 20,
};

const x402Icon: React.CSSProperties = {
  width:        36,
  height:       36,
  borderRadius: "50%",
  background:   "var(--green-light)",
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
  fontSize:     18,
};

const x402InfoBox: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "14px 16px",
  marginBottom: 20,
};

const createCard: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding:      "28px 32px",
  boxShadow:    "var(--shadow-sm)",
};

const errorBox: React.CSSProperties = {
  background:   "var(--red-light)",
  border:       "1px solid var(--red)",
  borderRadius: "var(--radius)",
  padding:      "12px 16px",
  fontSize:     13,
  color:        "var(--red)",
  marginBottom: 14,
  lineHeight:   1.5,
};

const successBox: React.CSSProperties = {
  background:   "var(--green-light)",
  border:       "1px solid var(--green)",
  borderRadius: "var(--radius)",
  padding:      "14px 18px",
  marginBottom: 14,
};

const btnPrimary: React.CSSProperties = {
  width:        "100%",
  background:   "var(--cta)",
  color:        "#FFFFFF",
  border:       "none",
  borderRadius: "var(--radius)",
  padding:      "13px",
  fontSize:     15,
  fontWeight:   700,
  cursor:       "pointer",
  letterSpacing: "-0.1px",
};

const devDetails: React.CSSProperties = {
  marginTop:    20,
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "14px 18px",
};

const devSummary: React.CSSProperties = {
  cursor:     "pointer",
  fontSize:   13,
  fontWeight: 600,
  color:      "var(--text-2)",
  userSelect: "none" as const,
};

const devInfoBox: React.CSSProperties = {
  display:      "flex",
  gap:          12,
  alignItems:   "flex-start",
  background:   "rgba(200,150,58,0.07)",
  border:       "1px solid rgba(200,150,58,0.2)",
  borderRadius: "var(--radius)",
  padding:      "12px 14px",
};

const inputSm: React.CSSProperties = {
  padding:      "8px 12px",
  fontSize:     13,
  borderRadius: "var(--radius)",
};

const btnSm: React.CSSProperties = {
  background:    "var(--cta)",
  color:         "#fff",
  border:        "1px solid var(--cta)",
  borderRadius:  "var(--radius)",
  padding:       "8px 16px",
  cursor:        "pointer",
  fontSize:      13,
  fontWeight:    600,
  display:       "flex",
  alignItems:    "center",
  gap:           6,
  whiteSpace:    "nowrap" as const,
};

const agentNote: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          10,
  background:   "var(--green-light)",
  border:       "1px solid rgba(42,125,82,0.3)",
  borderRadius: "var(--radius)",
  padding:      "10px 14px",
  fontSize:     12,
  color:        "var(--green)",
  fontWeight:   600,
  marginBottom: 14,
};

const flowDiagram: React.CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  gap:            10,
  flexWrap:       "wrap" as const,
  marginBottom:   24,
  padding:        "16px",
  background:     "var(--surface-2)",
  borderRadius:   "var(--radius)",
  border:         "1px solid var(--border)",
};

const flowStep: React.CSSProperties = {
  display:       "flex",
  alignItems:    "center",
  gap:           6,
  fontSize:      12,
  fontWeight:    600,
  padding:       "6px 12px",
  background:    "var(--surface)",
  color:         "var(--text)",
  borderRadius:  "var(--radius)",
  border:        "1px solid var(--border)",
  boxShadow:     "var(--shadow-sm)",
};
