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
      <h3 style={{ margin: "0 0 16px", color: "var(--text)" }}>Redeem {assetSymbol}</h3>

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
        <div style={hint}>≈ {estimatedUSDC.toFixed(6)} USDC @ ${oraclePrice}</div>
      )}

      {error && <div style={errorStyle}>{error}</div>}

      <button
        onClick={handleRedeem}
        disabled={!signer || !synthAmount || loading}
        style={btnStyle(loading || !signer)}
      >
        {loading ? "Redeeming…" : "Redeem"}
      </button>
    </div>
  );
}

const card: React.CSSProperties      = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginBottom: 20 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", fontSize: 15, marginBottom: 8, outline: "none" };
const hint: React.CSSProperties      = { fontSize: 12, color: "var(--muted)", marginBottom: 12 };
const errorStyle: React.CSSProperties = { fontSize: 13, color: "var(--red)", marginBottom: 12, wordBreak: "break-word" };
function btnStyle(disabled: boolean): React.CSSProperties {
  return { width: "100%", background: disabled ? "var(--border)" : "var(--green)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "12px", fontSize: 15, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600 };
}
