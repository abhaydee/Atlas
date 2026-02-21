/**
 * PoolPanel — SynthPool AMM interface.
 *
 * Two tabs:
 *   Swap   — buy synth with USDC (long) or sell synth for USDC (exit long)
 *   Liquidity — add or remove LP positions
 */

import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { SYNTH_POOL_ABI, ERC20_ABI } from "../lib/abis.ts";

interface Props {
  poolAddress:   string;
  usdcAddress:   string;
  synthAddress:  string;
  assetSymbol:   string;
  oraclePrice:   string; // human-readable USD from backend
  signer:        ethers.JsonRpcSigner | null;
  userAddress:   string | null;
  backendUrl:    string;
  marketId:      string;
  onSuccess:     () => void;
  onOperationRecord?: (op: { txHash: string; operationType: string; amount: string; symbol: string }) => void;
}

type Tab = "swap" | "liquidity";
type SwapDir = "buy" | "sell";
type LiqAction = "add" | "remove";

interface PoolInfo {
  usdcReserve:  string;
  synthReserve: string;
  ammPrice:     string;
  lpSupply:     string;
  userLp:       string;
}

export function PoolPanel({
  poolAddress, usdcAddress, synthAddress, assetSymbol,
  oraclePrice, signer, userAddress, backendUrl, marketId, onSuccess, onOperationRecord,
}: Props) {
  const [tab,        setTab]        = useState<Tab>("swap");
  const [swapDir,    setSwapDir]    = useState<SwapDir>("buy");
  const [liqAction,  setLiqAction]  = useState<LiqAction>("add");

  // Swap state
  const [swapIn,     setSwapIn]     = useState("");
  const [swapQuote,  setSwapQuote]  = useState<{ out: string; impact: string } | null>(null);
  const [swapStatus, setSwapStatus] = useState<"idle" | "approving" | "swapping">("idle");
  const [swapError,  setSwapError]  = useState<string | null>(null);

  // Liquidity state
  const [addUsdc,    setAddUsdc]    = useState("");
  const [addSynth,   setAddSynth]   = useState("");
  const [removeLP,   setRemoveLP]   = useState("");
  const [liqStatus,  setLiqStatus]  = useState<"idle" | "approving" | "pending">("idle");
  const [liqError,   setLiqError]   = useState<string | null>(null);
  const [liqResult,  setLiqResult]  = useState<string | null>(null);

  // Pool info
  const [poolInfo,   setPoolInfo]   = useState<PoolInfo | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);

  // ── Fetch pool state ─────────────────────────────────────────────────────────
  // Uses the backend API for read-only stats (no wallet required).
  // If wallet is connected, also fetches user's LP token balance from chain.

  const fetchPool = useCallback(async () => {
    if (!poolAddress) return;
    setLoadingPool(true);
    try {
      // Read-only pool stats from backend
      const res = await fetch(`${backendUrl}/markets/${marketId}/pool`);
      if (!res.ok) throw new Error(`Pool API ${res.status}`);
      const data = await res.json() as {
        usdcReserve:  string;
        synthReserve: string;
        ammPrice:     string;
        lpSupply:     string;
        hasLiquidity: boolean;
      };

      // Fetch user LP balance from chain if wallet connected
      let userLp = "0";
      if (userAddress && signer?.provider) {
        try {
          const lp = new ethers.Contract(poolAddress, ERC20_ABI, signer.provider);
          const bal: bigint = await lp.balanceOf(userAddress) as bigint;
          userLp = ethers.formatEther(bal);
        } catch { /* ignore — balance stays 0 */ }
      }

      setPoolInfo({
        usdcReserve:  parseFloat(data.usdcReserve).toFixed(4),
        synthReserve: parseFloat(data.synthReserve).toFixed(6),
        ammPrice:     parseFloat(data.ammPrice).toFixed(4),
        lpSupply:     parseFloat(data.lpSupply).toFixed(4),
        userLp,
      });
    } catch {
      // Silent — pool may not be deployed yet
    } finally {
      setLoadingPool(false);
    }
  }, [poolAddress, backendUrl, marketId, signer, userAddress]);

  useEffect(() => { fetchPool(); }, [fetchPool]);

  // ── Live swap quote ─────────────────────────────────────────────────────────

  useEffect(() => {
    const val = parseFloat(swapIn);
    if (!val || val <= 0 || !signer?.provider) { setSwapQuote(null); return; }

    const timer = setTimeout(async () => {
      try {
        const pool = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer.provider!);
        if (swapDir === "buy") {
          const rawIn = BigInt(Math.round(val * 1e6));
          const [synthOut, impactBps] = await pool.quoteUsdcForSynth(rawIn) as [bigint, bigint];
          setSwapQuote({
            out:    ethers.formatEther(synthOut),
            impact: (Number(impactBps) / 100).toFixed(2) + "%",
          });
        } else {
          const rawIn = ethers.parseEther(swapIn);
          const [usdcOut, impactBps] = await pool.quoteSynthForUsdc(rawIn) as [bigint, bigint];
          setSwapQuote({
            out:    (Number(usdcOut) / 1e6).toFixed(4),
            impact: (Number(impactBps) / 100).toFixed(2) + "%",
          });
        }
      } catch { setSwapQuote(null); }
    }, 400);

    return () => clearTimeout(timer);
  }, [swapIn, swapDir, poolAddress, signer]);

  // ── Auto-fill synth amount when USDC changes (add liquidity) ───────────────

  useEffect(() => {
    if (!poolInfo || !addUsdc || parseFloat(poolInfo.usdcReserve) === 0) return;
    const ratio = parseFloat(poolInfo.synthReserve) / parseFloat(poolInfo.usdcReserve);
    setAddSynth((parseFloat(addUsdc) * ratio).toFixed(6));
  }, [addUsdc, poolInfo]);

  // ── Swap ────────────────────────────────────────────────────────────────────

  async function handleSwap() {
    if (!signer || !swapIn || parseFloat(swapIn) <= 0) return;
    setSwapError(null);
    const pool = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);

    try {
      if (swapDir === "buy") {
        // Approve USDC → pool
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
        const amountIn = BigInt(Math.round(parseFloat(swapIn) * 1e6));
        const user = await signer.getAddress();
        const allowance: bigint = await usdcContract.allowance(user, poolAddress) as bigint;
        if (allowance < amountIn) {
          setSwapStatus("approving");
          await (await usdcContract.approve(poolAddress, amountIn) as ethers.ContractTransactionResponse).wait();
        }
        setSwapStatus("swapping");
        const txBuy = await pool.swapUsdcForSynth(amountIn, 0n) as ethers.ContractTransactionResponse;
        const recBuy = await txBuy.wait();
        if (recBuy?.hash) onOperationRecord?.({ txHash: recBuy.hash, operationType: "buy", amount: swapIn, symbol: "USDC" });
      } else {
        // Approve synth → pool
        const synthContract = new ethers.Contract(synthAddress, ERC20_ABI, signer);
        const amountIn = ethers.parseEther(swapIn);
        const user = await signer.getAddress();
        const allowance: bigint = await synthContract.allowance(user, poolAddress) as bigint;
        if (allowance < amountIn) {
          setSwapStatus("approving");
          await (await synthContract.approve(poolAddress, amountIn) as ethers.ContractTransactionResponse).wait();
        }
        setSwapStatus("swapping");
        const txSell = await pool.swapSynthForUsdc(amountIn, 0n) as ethers.ContractTransactionResponse;
        const recSell = await txSell.wait();
        if (recSell?.hash) onOperationRecord?.({ txHash: recSell.hash, operationType: "sell", amount: swapIn, symbol: assetSymbol });
      }
      setSwapIn("");
      setSwapQuote(null);
      setSwapStatus("idle");
      await fetchPool();
      onSuccess();
    } catch (err: unknown) {
      setSwapError(parseContractError(err));
      setSwapStatus("idle");
    }
  }

  // ── Add liquidity ───────────────────────────────────────────────────────────

  async function handleAddLiquidity() {
    if (!signer || !addUsdc || !addSynth) return;
    setLiqError(null); setLiqResult(null);
    const pool   = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
    const usdc   = new ethers.Contract(usdcAddress,  ERC20_ABI, signer);
    const synth  = new ethers.Contract(synthAddress, ERC20_ABI, signer);
    const user   = await signer.getAddress();

    const usdcAmt  = BigInt(Math.round(parseFloat(addUsdc)  * 1e6));
    const synthAmt = ethers.parseEther(addSynth);

    try {
      setLiqStatus("approving");
      const [uAllowance, sAllowance] = await Promise.all([
        usdc.allowance(user, poolAddress)  as Promise<bigint>,
        synth.allowance(user, poolAddress) as Promise<bigint>,
      ]);
      if (uAllowance < usdcAmt) {
        await (await usdc.approve(poolAddress, usdcAmt) as ethers.ContractTransactionResponse).wait();
      }
      if (sAllowance < synthAmt) {
        await (await synth.approve(poolAddress, synthAmt) as ethers.ContractTransactionResponse).wait();
      }

      setLiqStatus("pending");
      const txAdd = await pool.addLiquidity(usdcAmt, synthAmt) as ethers.ContractTransactionResponse;
      const recAdd = await txAdd.wait();
      if (recAdd?.hash) onOperationRecord?.({ txHash: recAdd.hash, operationType: "add-liquidity", amount: addUsdc, symbol: "USDC" });

      setAddUsdc(""); setAddSynth("");
      setLiqResult("Liquidity added! You earn 0.5% of swap fees as LP; 0.5% goes to the vault.");
      setLiqStatus("idle");
      await fetchPool();
      onSuccess();
    } catch (err: unknown) {
      setLiqError(parseContractError(err));
      setLiqStatus("idle");
    }
  }

  // ── Remove liquidity ────────────────────────────────────────────────────────

  async function handleRemoveLiquidity() {
    if (!signer || !removeLP || parseFloat(removeLP) <= 0) return;
    setLiqError(null); setLiqResult(null);
    const pool  = new ethers.Contract(poolAddress, SYNTH_POOL_ABI, signer);
    const lpRaw = ethers.parseEther(removeLP);

    try {
      setLiqStatus("pending");
      const txRem = await pool.removeLiquidity(lpRaw) as ethers.ContractTransactionResponse;
      const recRem = await txRem.wait();
      if (recRem?.hash) onOperationRecord?.({ txHash: recRem.hash, operationType: "remove-liquidity", amount: removeLP, symbol: "LP" });
      setRemoveLP("");
      setLiqResult("Liquidity removed. Tokens returned to your wallet.");
      setLiqStatus("idle");
      await fetchPool();
      onSuccess();
    } catch (err: unknown) {
      setLiqError(parseContractError(err));
      setLiqStatus("idle");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const oracleNum = parseFloat(oraclePrice) || 0;
  const ammNum    = parseFloat(poolInfo?.ammPrice ?? "0");
  const priceDiff = oracleNum > 0 && ammNum > 0
    ? ((ammNum - oracleNum) / oracleNum * 100).toFixed(2)
    : null;

  const noLiquidity = poolInfo && parseFloat(poolInfo.usdcReserve) === 0;

  return (
    <div style={card}>
      {/* ── Header ── */}
      <div style={headerRow}>
        <div>
          <h3 style={{ margin: 0, color: "var(--text)" }}>AMM Pool — Long Exposure</h3>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            Buy {assetSymbol} to go long · Sell to exit · Provide liquidity to earn fees
          </div>
        </div>
        <button onClick={fetchPool} disabled={loadingPool} style={refreshBtn}>
          {loadingPool ? "…" : "↺"}
        </button>
      </div>

      {/* ── Pool stats ── */}
      {poolInfo && (
        <div style={statsGrid}>
          <Stat label="USDC Reserve"   value={`$${poolInfo.usdcReserve}`} />
          <Stat label={`${assetSymbol} Reserve`} value={poolInfo.synthReserve} />
          <Stat
            label="AMM Price"
            value={`$${poolInfo.ammPrice}`}
            sub={priceDiff !== null
              ? `${priceDiff}% vs oracle`
              : undefined}
            subColor={priceDiff !== null
              ? (Math.abs(parseFloat(priceDiff)) > 2 ? "var(--red)" : "var(--green)")
              : undefined}
          />
          <Stat label="LP Supply"      value={poolInfo.lpSupply} />
          {userAddress && <Stat label="Your LP"  value={parseFloat(poolInfo.userLp).toFixed(4)} accent />}
        </div>
      )}

      {noLiquidity && (
        <div style={infoBox}>
          Pool has no liquidity yet — add some below to enable trading.
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={tabRow}>
        <TabBtn active={tab === "swap"}      onClick={() => setTab("swap")}>Swap</TabBtn>
        <TabBtn active={tab === "liquidity"} onClick={() => setTab("liquidity")}>Liquidity</TabBtn>
      </div>

      {/* ── Swap tab ── */}
      {tab === "swap" && (
        <div>
          {/* Direction toggle */}
          <div style={dirRow}>
            <DirBtn active={swapDir === "buy"}  onClick={() => { setSwapDir("buy");  setSwapIn(""); setSwapQuote(null); }}>
              Buy {assetSymbol} <span style={{ fontSize: 11, color: "var(--muted)" }}>(Long)</span>
            </DirBtn>
            <DirBtn active={swapDir === "sell"} onClick={() => { setSwapDir("sell"); setSwapIn(""); setSwapQuote(null); }}>
              Sell {assetSymbol} <span style={{ fontSize: 11, color: "var(--muted)" }}>(Exit)</span>
            </DirBtn>
          </div>

          <label style={labelStyle}>
            {swapDir === "buy" ? "USDC to spend" : `${assetSymbol} to sell`}
          </label>
          <input
            type="number" min="0" step="any" placeholder="0.00"
            value={swapIn}
            onChange={(e) => setSwapIn(e.target.value)}
            style={inputStyle}
            disabled={swapStatus !== "idle"}
          />

          {swapQuote && (
            <div style={quoteBox}>
              <div>You receive: <strong>
                {swapDir === "buy"
                  ? `${parseFloat(swapQuote.out).toFixed(6)} ${assetSymbol}`
                  : `$${swapQuote.out} USDC`}
              </strong></div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Price impact: {swapQuote.impact} · Fee: 1% (0.5% to vault)
              </div>
            </div>
          )}

          {swapError && <div style={errorStyle}>{swapError}</div>}

          <button
            onClick={handleSwap}
            disabled={!signer || !swapIn || swapStatus !== "idle"}
            style={btnStyle(!signer || !swapIn || swapStatus !== "idle")}
          >
            {swapStatus === "approving" ? "Approving…"
              : swapStatus === "swapping" ? "Swapping…"
              : swapDir === "buy"
              ? `Buy ${assetSymbol} (Long)`
              : `Sell ${assetSymbol}`}
          </button>
        </div>
      )}

      {/* ── Liquidity tab ── */}
      {tab === "liquidity" && (
        <div>
          <div style={dirRow}>
            <DirBtn active={liqAction === "add"}    onClick={() => { setLiqAction("add");    setLiqError(null); setLiqResult(null); }}>
              Add Liquidity
            </DirBtn>
            <DirBtn active={liqAction === "remove"} onClick={() => { setLiqAction("remove"); setLiqError(null); setLiqResult(null); }}>
              Remove Liquidity
            </DirBtn>
          </div>

          {liqAction === "add" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>USDC amount</label>
                  <input
                    type="number" min="0" step="any" placeholder="0.00"
                    value={addUsdc}
                    onChange={(e) => setAddUsdc(e.target.value)}
                    style={inputStyle}
                    disabled={liqStatus !== "idle"}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{assetSymbol} amount</label>
                  <input
                    type="number" min="0" step="any" placeholder="0.000000"
                    value={addSynth}
                    onChange={(e) => setAddSynth(e.target.value)}
                    style={inputStyle}
                    disabled={liqStatus !== "idle"}
                  />
                </div>
              </div>
              {poolInfo && parseFloat(poolInfo.usdcReserve) > 0 && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Pool ratio: 1 {assetSymbol} ≈ {poolInfo.ammPrice} USDC · {assetSymbol} amount auto-calculated.
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
                You earn 0.5% of every swap as LP (0.5% goes to the vault).
              </div>
              {liqError  && <div style={errorStyle}>{liqError}</div>}
              {liqResult && <div style={successStyle}>{liqResult}</div>}
              <button
                onClick={handleAddLiquidity}
                disabled={!signer || !addUsdc || !addSynth || liqStatus !== "idle"}
                style={btnStyle(!signer || !addUsdc || !addSynth || liqStatus !== "idle")}
              >
                {liqStatus === "approving" ? "Approving…"
                  : liqStatus === "pending" ? "Adding liquidity…"
                  : "Approve & Add Liquidity"}
              </button>
            </>
          ) : (
            <>
              <label style={labelStyle}>LP tokens to burn</label>
              <input
                type="number" min="0" step="any" placeholder="0.00"
                value={removeLP}
                onChange={(e) => setRemoveLP(e.target.value)}
                style={inputStyle}
                disabled={liqStatus !== "idle"}
              />
              {poolInfo && userAddress && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Your LP: {parseFloat(poolInfo.userLp).toFixed(4)}&nbsp;
                  <span
                    style={{ color: "var(--accent)", cursor: "pointer" }}
                    onClick={() => setRemoveLP(parseFloat(poolInfo.userLp).toFixed(6))}
                  >
                    (max)
                  </span>
                </div>
              )}
              {liqError  && <div style={errorStyle}>{liqError}</div>}
              {liqResult && <div style={successStyle}>{liqResult}</div>}
              <button
                onClick={handleRemoveLiquidity}
                disabled={!signer || !removeLP || liqStatus !== "idle"}
                style={btnStyle(!signer || !removeLP || liqStatus !== "idle")}
              >
                {liqStatus === "pending" ? "Removing…" : "Remove Liquidity"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseContractError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("user rejected") || raw.includes("ACTION_REJECTED")) return "Transaction cancelled.";
  if (raw.includes("stale price") || raw.includes("OracleReader: stale")) {
    return "Oracle price is stale — click \"Fetch from research URLs\" in Dev Tools to refresh it, then retry.";
  }
  if (raw.includes("insufficient liquidity") || raw.includes("Pool: insufficient")) {
    return "Pool has insufficient liquidity. Add liquidity first via the Liquidity tab.";
  }
  if (raw.includes("insufficient allowance") || raw.includes("ERC20: insufficient allowance")) {
    return "Token approval failed — please try again.";
  }
  if (raw.includes("insufficient balance") || raw.includes("ERC20: transfer amount exceeds balance")) {
    return "Insufficient token balance.";
  }
  if (raw.includes("Pool: zero reserves")) {
    return "Pool has no liquidity yet. Add liquidity first via the Liquidity tab.";
  }
  // Extract revert reason from ethers error if present
  const match = raw.match(/reason="([^"]+)"|revert reason: ([^\n]+)|execution reverted: ([^\n"]+)/i);
  if (match) return match[1] ?? match[2] ?? match[3] ?? raw;
  return raw.slice(0, 200);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value, sub, subColor, accent }: {
  label: string; value: string;
  sub?: string; subColor?: string; accent?: boolean;
}) {
  return (
    <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: accent ? "var(--accent)" : "var(--text)" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: subColor ?? "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: active ? "var(--accent)" : "var(--bg)",
      color: active ? "#fff" : "var(--muted)",
      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      padding: "8px",
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

function DirBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: active ? "rgba(108,99,255,0.15)" : "transparent",
      color: active ? "var(--accent)" : "var(--muted)",
      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      padding: "7px 12px",
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      24,
  marginBottom: 20,
};

const headerRow: React.CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "flex-start",
  marginBottom:   16,
};

const refreshBtn: React.CSSProperties = {
  background:   "transparent",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color:        "var(--muted)",
  cursor:       "pointer",
  padding:      "4px 10px",
  fontSize:     16,
};

const statsGrid: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap:                 10,
  marginBottom:        20,
};

const tabRow: React.CSSProperties = {
  display:      "flex",
  gap:          8,
  marginBottom: 16,
};

const dirRow: React.CSSProperties = {
  display:      "flex",
  gap:          8,
  marginBottom: 14,
};

const labelStyle: React.CSSProperties = {
  display:      "block",
  fontSize:     12,
  color:        "var(--muted)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width:        "100%",
  background:   "var(--bg)",
  color:        "var(--text)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "10px 12px",
  fontSize:     15,
  marginBottom: 10,
  outline:      "none",
  boxSizing:    "border-box",
};

const quoteBox: React.CSSProperties = {
  background:   "rgba(108,99,255,0.08)",
  border:       "1px solid var(--accent)",
  borderRadius: "var(--radius)",
  padding:      "10px 14px",
  fontSize:     13,
  marginBottom: 12,
};

const infoBox: React.CSSProperties = {
  background:   "rgba(255,200,0,0.08)",
  border:       "1px solid rgba(255,200,0,0.3)",
  borderRadius: "var(--radius)",
  padding:      "10px 14px",
  fontSize:     13,
  color:        "var(--muted)",
  marginBottom: 14,
};

const errorStyle: React.CSSProperties = {
  fontSize:     13,
  color:        "var(--red)",
  marginBottom: 12,
  wordBreak:    "break-word",
};

const successStyle: React.CSSProperties = {
  fontSize:     13,
  color:        "var(--green)",
  marginBottom: 12,
};

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    width:        "100%",
    background:   disabled ? "var(--border)" : "var(--accent)",
    color:        "#fff",
    border:       "none",
    borderRadius: "var(--radius)",
    padding:      "12px",
    fontSize:     15,
    fontWeight:   600,
    cursor:       disabled ? "not-allowed" : "pointer",
  };
}
