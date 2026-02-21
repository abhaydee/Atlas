import React, { useState } from "react";
import { ethers } from "ethers";
import { SYNTHETIC_VAULT_ABI } from "../lib/abis.ts";

interface Props {
  vaultAddress: string;
  oraclePrice:  string;
  assetSymbol:  string;
  signer:       ethers.JsonRpcSigner | null;
  onSuccess:    () => void;
}

export function RedeemForm({ vaultAddress, oraclePrice, assetSymbol, signer, onSuccess }: Props) {
  const [synthAmount, setSynthAmount] = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const price = parseFloat(oraclePrice) || 0;
  const estimatedUSDC = price > 0 ? (parseFloat(synthAmount) || 0) * price : 0;

  async function handleRedeem() {
    if (!signer || !synthAmount || parseFloat(synthAmount) <= 0) return;
    setError(null);
    setLoading(true);

    try {
      const vaultContract = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);
      const amountBig = ethers.parseUnits(synthAmount, 18);
      const tx = await vaultContract.redeem(amountBig);
      await (tx as ethers.ContractTransactionResponse).wait();
      setSynthAmount("");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("user rejected") ? "Transaction cancelled." : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          Redeem <span style={{ color: "var(--accent)" }}>[</span> {assetSymbol} <span style={{ color: "var(--accent)" }}>]</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Burn synthetic tokens → receive USDC</div>
      </div>

      <label style={labelStyle}>{assetSymbol} Amount</label>
      <input
        type="number"
        min="0"
        step="any"
        placeholder="0.00"
        value={synthAmount}
        onChange={(e) => setSynthAmount(e.target.value)}
        style={inputStyle}
        disabled={loading}
      />

      {price > 0 && parseFloat(synthAmount) > 0 && (
        <div style={hint}>≈ {estimatedUSDC.toFixed(6)} USDC at ${oraclePrice}</div>
      )}

      {error && (
        <div style={errorStyle}>
          <span style={{ fontWeight: 700 }}>⚠ </span>
          {error.includes("user rejected") ? "Transaction cancelled." : error}
          {(error.includes("stale") || error.includes("oracle")) && (
            <div style={{ marginTop: 5, fontSize: 11 }}>Use Dev Tools → Refresh Oracle, then retry.</div>
          )}
        </div>
      )}

      <button
        onClick={handleRedeem}
        disabled={!signer || !synthAmount || loading}
        style={btnStyle(loading || !signer)}
      >
        {loading
          ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 6 }}>↻</span>Redeeming…</>
          : !signer
          ? "Connect Wallet to Redeem"
          : "Redeem for USDC"}
      </button>
    </div>
  );
}

const card: React.CSSProperties       = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", marginBottom: 20, boxShadow: "var(--shadow-sm)" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 14px", fontSize: 15, marginBottom: 8, boxSizing: "border-box" as const };
const hint: React.CSSProperties       = { fontSize: 12, color: "var(--muted)", marginBottom: 12, padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" };
const errorStyle: React.CSSProperties = { fontSize: 13, color: "var(--red)", marginBottom: 12, wordBreak: "break-word" as const, background: "var(--red-light)", border: "1px solid var(--red)", borderRadius: "var(--radius)", padding: "10px 14px", lineHeight: 1.5 };
function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", background: disabled ? "var(--border)" : "var(--green)", color: disabled ? "var(--muted)" : "#fff",
    border: "none", borderRadius: "var(--radius)", padding: "12px", fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
  };
}
