import React, { useState } from "react";
import { ethers } from "ethers";
import { SYNTHETIC_VAULT_ABI, ERC20_ABI } from "../lib/abis.ts";

interface Props {
  vaultAddress: string;
  usdcAddress:  string;
  oraclePrice:  string;
  assetSymbol:  string;
  signer:       ethers.JsonRpcSigner | null;
  onSuccess:    () => void;
}

export function MintForm({ vaultAddress, usdcAddress, oraclePrice, assetSymbol, signer, onSuccess }: Props) {
  const [usdcAmount, setUsdcAmount] = useState("");
  const [status, setStatus]         = useState<"idle" | "approving" | "minting">("idle");
  const [error, setError]           = useState<string | null>(null);

  const price = parseFloat(oraclePrice) || 0;
  const estimatedSynth = price > 0 ? (parseFloat(usdcAmount) || 0) / price : 0;

  async function handleMint() {
    if (!signer || !usdcAmount || parseFloat(usdcAmount) <= 0) return;
    setError(null);

    try {
      const usdcContract  = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
      const vaultContract = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);

      const decimals: bigint  = await usdcContract.decimals();
      const amountBig = ethers.parseUnits(usdcAmount, decimals);

      // Check and set allowance
      const userAddress = await signer.getAddress();
      const allowance: bigint = await usdcContract.allowance(userAddress, vaultAddress);

      if (allowance < amountBig) {
        setStatus("approving");
        const approveTx = await usdcContract.approve(vaultAddress, amountBig);
        await (approveTx as ethers.ContractTransactionResponse).wait();
      }

      setStatus("minting");
      const mintTx = await vaultContract.mint(amountBig);
      await (mintTx as ethers.ContractTransactionResponse).wait();

      setUsdcAmount("");
      setStatus("idle");
      onSuccess();
    } catch (err: unknown) {
      setError(parseContractError(err));
      setStatus("idle");
    }
  }

  return (
    <div style={card}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          Mint <span style={{ color: "var(--accent)" }}>[</span> {assetSymbol} <span style={{ color: "var(--accent)" }}>]</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Deposit USDC → receive synthetic tokens</div>
      </div>

      <label style={labelStyle}>USDC Amount</label>
      <input
        type="number"
        min="0"
        step="any"
        placeholder="0.00"
        value={usdcAmount}
        onChange={(e) => setUsdcAmount(e.target.value)}
        style={inputStyle}
        disabled={status !== "idle"}
      />

      {price > 0 && parseFloat(usdcAmount) > 0 && (
        <div style={hint}>
          ≈ {estimatedSynth.toFixed(6)} {assetSymbol} at ${oraclePrice}
        </div>
      )}

      {error && (
        <div style={errorStyle}>
          <span style={{ fontWeight: 700 }}>⚠ </span>{error}
          {error.includes("stale") && (
            <div style={{ marginTop: 5, fontSize: 11 }}>Use Dev Tools → Refresh Oracle to push a fresh price on-chain.</div>
          )}
          {error.includes("USDC") && (
            <div style={{ marginTop: 5, fontSize: 11 }}>Get testnet USDC at <a href="https://faucet.gokite.ai" target="_blank" rel="noreferrer" style={{ color: "var(--red)", fontWeight: 700 }}>faucet.gokite.ai</a></div>
          )}
        </div>
      )}

      <button
        onClick={handleMint}
        disabled={!signer || !usdcAmount || status !== "idle"}
        style={btnStyle(status !== "idle")}
      >
        {status === "approving"
          ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 6 }}>↻</span>Approving USDC…</>
          : status === "minting"
          ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 6 }}>↻</span>Minting…</>
          : !signer
          ? "Connect Wallet to Mint"
          : "Approve & Mint"}
      </button>
    </div>
  );
}

function parseContractError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("user rejected") || raw.includes("ACTION_REJECTED")) return "Transaction cancelled.";
  if (raw.includes("stale price") || raw.includes("OracleReader: stale") || raw.includes("stale")) {
    return "Oracle price is stale (>2h old). Use Dev Tools → Refresh Oracle, then retry.";
  }
  if (raw.includes("synthetic amount too small")) {
    return "Amount too small — try a larger USDC amount.";
  }
  if (raw.includes("insufficient allowance") || raw.includes("ERC20: insufficient allowance")) {
    return "Approval failed — please try again.";
  }
  if (raw.includes("insufficient balance") || raw.includes("ERC20: transfer amount exceeds balance")) {
    return "Insufficient USDC balance in your wallet.";
  }
  const match = raw.match(/reason="([^"]+)"|revert reason: ([^\n]+)|execution reverted: ([^\n"]+)/i);
  if (match) return match[1] ?? match[2] ?? match[3] ?? raw;
  return raw.slice(0, 200);
}

const card: React.CSSProperties       = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", marginBottom: 20, boxShadow: "var(--shadow-sm)" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 14px", fontSize: 15, marginBottom: 8, boxSizing: "border-box" as const };
const hint: React.CSSProperties       = { fontSize: 12, color: "var(--muted)", marginBottom: 12, padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" };
const errorStyle: React.CSSProperties = { fontSize: 13, color: "var(--red)", marginBottom: 12, wordBreak: "break-word" as const, background: "var(--red-light)", border: "1px solid var(--red)", borderRadius: "var(--radius)", padding: "10px 14px", lineHeight: 1.5 };
function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", background: disabled ? "var(--border)" : "var(--cta)", color: disabled ? "var(--muted)" : "#fff",
    border: "none", borderRadius: "var(--radius)", padding: "12px", fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
  };
}
