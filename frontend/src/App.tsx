/**
 * Oracle Synthetic Protocol — Multi-Market App
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
  };
}

interface CreateForm {
  assetName:        string;
  assetSymbol:      string;
  assetDescription: string;
  totalPayment:     string;
}

type Phase = "idle" | "creating" | "streaming" | "done" | "failed";

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // View: dashboard | market | create
  const [view, setView] = useState<"dashboard" | "market" | "create">("dashboard");

  // Wallet (for trading only)
  const [provider,    setProvider]    = useState<ethers.BrowserProvider | null>(null);
  const [signer,      setSigner]      = useState<ethers.JsonRpcSigner | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);

  // Selected market (trading view)
  const [selectedMarket, setSelectedMarket] = useState<MarketData | null>(null);
  const [marketLoading,  setMarketLoading]  = useState(false);
  const [usdcBalance,    setUsdcBalance]    = useState("0");
  const [synthBalance,   setSynthBalance]   = useState("0");

  // Dev oracle override + pool seeding
  const [devPrice,   setDevPrice]   = useState("");
  const [seedAmount, setSeedAmount] = useState("");
  const [devLoading, setDevLoading] = useState(false);

  // Create market form
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

  // ── Wallet ──────────────────────────────────────────────────────────────────

  async function connectWallet() {
    if (!window.ethereum) { alert("MetaMask required for trading."); return; }
    const p = new ethers.BrowserProvider(window.ethereum);
    const s = await p.getSigner();
    setProvider(p); setSigner(s);
    setUserAddress(await s.getAddress());
  }

  function disconnectWallet() {
    setProvider(null); setSigner(null); setUserAddress(null);
    setUsdcBalance("0"); setSynthBalance("0");
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

  // Auto-refresh selected market
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
      if (!res.ok || !data.success || !data.jobId) throw new Error(data.error ?? `Server error ${res.status}`);
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
    // Auto-navigate to dashboard after 2s so user sees the new market card
    setTimeout(() => setView("dashboard"), 2000);
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
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
    finally { setDevLoading(false); }
  }

  async function handleUpdateOracle() {
    if (!selectedMarket) return;
    setDevLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/markets/${selectedMarket.id}/oracle`, { method: "POST" });
      const data = await res.json() as { success?: boolean; price?: number; source?: string; error?: string };
      if (!data.success) throw new Error(data.error);
      alert(`Oracle updated: $${data.price?.toFixed(4)} from ${data.source}`);
      await fetchSelectedMarket(selectedMarket.id);
    } catch (err) { alert(`Oracle update failed: ${err instanceof Error ? err.message : String(err)}`); }
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
      if (!data.success) throw new Error(data.error);
      alert(`Pool seeded! ${data.usdcSeeded} USDC + ${data.synthSeeded?.toFixed(6)} synth. Tx: ${data.txHash}`);
      setSeedAmount("");
      await fetchSelectedMarket(selectedMarket.id);
    } catch (err) { alert(`Seed failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setDevLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {view !== "dashboard" && (
            <button onClick={handleGoToDashboard} style={backBtn}>← Markets</button>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, color: "var(--accent)" }}>
              Oracle Synthetic Protocol
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Kite L1 Testnet · Autonomous Agent · x402
            </div>
          </div>
        </div>
        <WalletConnect address={userAddress} onConnect={connectWallet} onDisconnect={disconnectWallet} />
      </div>

      {/* Agent identity — always visible */}
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
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Loading market data…</div>
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

              {/* Payment proof */}
              {selectedMarket.paymentLog?.txHash && (
                <div style={paymentProof}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>
                    Agent Payment Settlement
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                    <ProofItem label="Amount"  value={selectedMarket.paymentLog.amountHuman} green />
                    <ProofItem label="Status"  value={selectedMarket.paymentLog.status} />
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Tx Hash</div>
                      <a
                        href={`https://testnet.kitescan.ai/tx/${selectedMarket.paymentLog.txHash}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent)", textDecoration: "none" }}
                      >
                        {selectedMarket.paymentLog.txHash.slice(0, 14)}… ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {!userAddress && (
                <div style={notice}>Connect your wallet above to trade.</div>
              )}

              {/* USDC faucet notice */}
              {userAddress && parseFloat(usdcBalance) === 0 && (
                <div style={faucetNotice}>
                  <strong>You have no testnet USDC.</strong>
                  {" "}Get some from the{" "}
                  <a href="https://faucet.gokite.ai/" target="_blank" rel="noreferrer"
                    style={{ color: "var(--accent)", fontWeight: 700 }}>
                    Kite faucet ↗
                  </a>
                  {" "}then refresh your balance.
                </div>
              )}

              {/* Vault */}
              <div style={sectionLabel}>
                <div style={sectionTitle}>Vault — Short Exposure</div>
                <div style={sectionSub}>Deposit USDC → issue {selectedMarket.assetSymbol} debt. Profit if oracle price falls.</div>
              </div>
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

              {/* AMM Pool */}
              {selectedMarket.contracts.synthPool && (
                <>
                  <div style={sectionLabel}>
                    <div style={sectionTitle}>AMM Pool — Long Exposure</div>
                    <div style={sectionSub}>Swap USDC for {selectedMarket.assetSymbol} to go long. Earn 1% fees as LP.</div>
                  </div>
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

              {/* Dev tools */}
              {selectedMarket.contracts.oracleAggregator && (
                <details style={detailsStyle}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>
                    Dev Tools — Oracle &amp; Pool
                  </summary>
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>

                    {/* Oracle update */}
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                        Oracle — if price is stale (&gt;2h old), transactions will fail
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => void handleUpdateOracle()} disabled={devLoading} style={btnSm}>
                          {devLoading ? "Updating…" : "Refresh Oracle (Pyth)"}
                        </button>
                      </div>
                    </div>

                    {/* Manual price override */}
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Manual price override (dev only)</div>
                      <form onSubmit={(e) => void handleSetPrice(e)} style={{ display: "flex", gap: 8 }}>
                        <input
                          type="number" step="any" min="0"
                          placeholder="Price in USD"
                          value={devPrice}
                          onChange={(e) => setDevPrice(e.target.value)}
                          style={{ ...inputSm, flex: 1 }}
                        />
                        <button type="submit" disabled={devLoading || !devPrice} style={btnSm}>
                          {devLoading ? "…" : "Set"}
                        </button>
                      </form>
                    </div>

                    {/* Seed pool */}
                    {selectedMarket.contracts.synthPool && (
                      <div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                          Seed pool with deployer wallet USDC (bootstraps liquidity)
                        </div>
                        <form onSubmit={(e) => void handleSeedPool(e)} style={{ display: "flex", gap: 8 }}>
                          <input
                            type="number" step="any" min="0"
                            placeholder="USDC amount (e.g. 20)"
                            value={seedAmount}
                            onChange={(e) => setSeedAmount(e.target.value)}
                            style={{ ...inputSm, flex: 1 }}
                          />
                          <button type="submit" disabled={devLoading || !seedAmount} style={{ ...btnSm, background: "var(--green)" }}>
                            {devLoading ? "Seeding…" : "Seed Pool"}
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

      {/* ── Create Market ── */}
      {view === "create" && (
        <div style={card}>
          <h2 style={{ marginTop: 0, color: "var(--accent)" }}>Create Synthetic Market</h2>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
            The autonomous agent pays the x402 fee from its own wallet, researches data sources,
            and deploys all contracts on Kite Testnet — no wallet confirmation required.
          </p>

          {/* Flow */}
          <div style={flowDiagram}>
            {["x402 Payment", "AI Research", "Deploy Contracts", "Oracle Init"].map((step, i, arr) => (
              <React.Fragment key={step}>
                <div style={flowStep}>{step}</div>
                {i < arr.length - 1 && <div style={{ color: "var(--muted)" }}>→</div>}
              </React.Fragment>
            ))}
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
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--green)", marginBottom: 8 }}>
                Market deployed! Returning to dashboard…
              </div>
              <ContractRow label="Vault"  address={lastJob.market.contracts.syntheticVault} />
              <ContractRow label="Token"  address={lastJob.market.contracts.syntheticToken} />
              <ContractRow label="Oracle" address={lastJob.market.contracts.oracleAggregator} />
            </div>
          )}

          {phaseErr && <div style={errorBox}>{phaseErr}</div>}

          {/* Form */}
          {(phase === "idle" || phase === "failed") && (
            <form onSubmit={(e) => void handleCreateMarket(e)}>
              <Field label="Asset Name" value={createForm.assetName}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetName: v }))}
                placeholder="Gold, Bitcoin, Silver, Oil Index…" />
              <Field label="Token Symbol" value={createForm.assetSymbol}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetSymbol: v }))}
                placeholder="sGLD, sBTC, sXAG…" />
              <Field label="Description" value={createForm.assetDescription}
                onChange={(v) => setCreateForm((f) => ({ ...f, assetDescription: v }))}
                placeholder="Describe the real-world asset…" />
              <Field label="Agent Fee (USDT — paid by agent wallet)" type="number"
                value={createForm.totalPayment}
                onChange={(v) => setCreateForm((f) => ({ ...f, totalPayment: v }))}
                placeholder="1" />

              <div style={{ background: "rgba(52,199,89,0.08)", border: "1px solid var(--green)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, color: "var(--green)", marginBottom: 14 }}>
                No wallet needed — agent signs and pays autonomously.
              </div>

              <button type="submit" style={{ ...btnFull, background: "var(--accent)" }}>
                Deploy Market (Autonomous)
              </button>
            </form>
          )}

          {phase === "streaming" && (
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
              Agent is executing autonomously — usually takes 1–3 minutes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
    </div>
  );
}

function ProofItem({ label, value, green = false }: { label: string; value: string; green?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: green ? "var(--green)" : "var(--text)", fontWeight: green ? 700 : undefined }}>{value}</div>
    </div>
  );
}

function ContractRow({ label, address }: { label: string; address: string }) {
  if (!address) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <a href={`https://testnet.kitescan.ai/address/${address}`} target="_blank" rel="noreferrer"
        style={{ fontFamily: "monospace", color: "var(--accent)", fontSize: 11, textDecoration: "none" }}>
        {address.slice(0, 10)}…{address.slice(-8)} ↗
      </a>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--border)" };
const cols: React.CSSProperties   = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const card: React.CSSProperties   = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24 };
const notice: React.CSSProperties       = { fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0", marginBottom: 16 };
const faucetNotice: React.CSSProperties = { fontSize: 13, background: "rgba(108,99,255,0.08)", border: "1px solid rgba(108,99,255,0.3)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 16 };
const errorBox: React.CSSProperties   = { background: "#2a0f0f", border: "1px solid var(--red)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13, color: "var(--red)", marginBottom: 14, wordBreak: "break-word" };
const successBox: React.CSSProperties = { background: "rgba(52,199,89,0.06)", border: "1px solid var(--green)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 14 };
const btnFull: React.CSSProperties    = { width: "100%", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "13px", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const detailsStyle: React.CSSProperties = { marginTop: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 16px" };
const inputSm: React.CSSProperties  = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px", fontSize: 14, outline: "none" };
const btnSm: React.CSSProperties    = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 16px", cursor: "pointer", fontSize: 14 };
const paymentProof: React.CSSProperties = { background: "rgba(52,199,89,0.05)", border: "1px solid rgba(52,199,89,0.3)", borderRadius: "var(--radius)", padding: "12px 16px", marginBottom: 16 };
const flowDiagram: React.CSSProperties  = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 20, padding: "12px", background: "var(--bg)", borderRadius: "var(--radius)" };
const flowStep: React.CSSProperties     = { fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "rgba(108,99,255,0.15)", color: "var(--accent)", borderRadius: 12, border: "1px solid var(--accent)" };
const sectionLabel: React.CSSProperties = { marginTop: 24, marginBottom: 12, paddingLeft: 4, borderLeft: "3px solid var(--accent)", paddingBottom: 2 };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "var(--text)" };
const sectionSub: React.CSSProperties   = { fontSize: 12, color: "var(--muted)", marginTop: 3 };
const backBtn: React.CSSProperties      = { background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, cursor: "pointer" };
