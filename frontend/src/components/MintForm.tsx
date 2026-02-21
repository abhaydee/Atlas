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
      <h3 style={{ margin: "0 0 16px", color: "var(--text)" }}>Mint {assetSymbol}</h3>

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
          ≈ {estimatedSynth.toFixed(6)} {assetSymbol} @ ${oraclePrice}
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}

      <button
        onClick={handleMint}
        disabled={!signer || !usdcAmount || status !== "idle"}
        style={btnStyle(status !== "idle")}
      >
        {status === "approving" ? "Approving USDC…" : status === "minting" ? "Minting…" : "Approve & Mint"}
      </button>
    </div>
  );
}

function parseContractError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("user rejected") || raw.includes("ACTION_REJECTED")) return "Transaction cancelled.";
  if (raw.includes("stale price") || raw.includes("OracleReader: stale")) {
    return "Oracle price is stale — click \"Fetch from research URLs\" in Dev Tools to refresh it, then retry.";
  }
  if (raw.includes("synthetic amount too small")) {
    return "Amount too small — try a larger USDC amount.";
  }
  if (raw.includes("insufficient allowance") || raw.includes("ERC20: insufficient allowance")) {
    return "Approval failed — please try again.";
  }
  const match = raw.match(/reason="([^"]+)"|revert reason: ([^\n]+)|execution reverted: ([^\n"]+)/i);
  if (match) return match[1] ?? match[2] ?? match[3] ?? raw;
  return raw.slice(0, 200);
}

const card: React.CSSProperties    = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginBottom: 20 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", fontSize: 15, marginBottom: 8, outline: "none" };
const hint: React.CSSProperties    = { fontSize: 12, color: "var(--muted)", marginBottom: 12 };
const errorStyle: React.CSSProperties = { fontSize: 13, color: "var(--red)", marginBottom: 12, wordBreak: "break-word" };
function btnStyle(disabled: boolean): React.CSSProperties {
  return { width: "100%", background: disabled ? "var(--border)" : "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "12px", fontSize: 15, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600 };
}
