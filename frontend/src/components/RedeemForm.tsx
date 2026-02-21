import React, { useState } from "react";
import { ethers } from "ethers";
import { SYNTHETIC_VAULT_ABI } from "../lib/abis.ts";

export interface OperationRecord { txHash: string; operationType: string; amount: string; symbol: string }

interface Props {
  vaultAddress: string; oraclePrice: string;
  assetSymbol: string; signer: ethers.JsonRpcSigner | null;
  onSuccess: (message?: string) => void;
  onOperationRecord?: (op: OperationRecord) => void;
}

export function RedeemForm({ vaultAddress, oraclePrice, assetSymbol, signer, onSuccess, onOperationRecord }: Props) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]  = useState<string | null>(null);

  const price   = parseFloat(oraclePrice) || 0;
  const estUsdc = price > 0 ? (parseFloat(amount) || 0) * price : 0;

  async function handle() {
    if (!signer || !amount || parseFloat(amount) <= 0) return;
    setError(null); setLoading(true);
    try {
      const vault = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);
      const tx = await vault.redeem(ethers.parseUnits(amount, 18)) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();
      setAmount("");
      onSuccess("Redeemed successfully — you received USDC.");
      if (receipt?.hash) onOperationRecord?.({ txHash: receipt.hash, operationType: "redeem", amount, symbol: assetSymbol });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/user rejected|ACTION_REJECTED/i.test(raw)) setError("Transaction cancelled.");
      else if (/stale/i.test(raw)) setError("Oracle price is stale (>2h old). Refresh oracle via Dev Tools.");
      else setError(raw.slice(0, 200));
    } finally { setLoading(false); }
  }

  const label = loading ? "Redeeming…" : !signer ? "Connect Wallet" : "Redeem for USDC";

  return (
    <div style={card}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 4 }}>
          Redeem <span style={{ color: "var(--green)" }}>[ {assetSymbol} ]</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Burn synthetic tokens → receive USDC back</div>
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 7 }}>
        {assetSymbol} Amount
      </div>
      <input className="field-input" type="number" min="0" step="any" placeholder="0.00"
        value={amount} onChange={(e) => setAmount(e.target.value)} disabled={loading}
        style={{ marginBottom: 8 }}
      />

      {price > 0 && parseFloat(amount) > 0 && (
        <div style={estimate}>
          ≈ <strong style={{ color: "var(--text)", fontFamily: "JetBrains Mono, monospace" }}>{estUsdc.toFixed(6)} USDC</strong>
          <span style={{ color: "var(--text-3)" }}> @ ${oraclePrice}</span>
        </div>
      )}

      {error && (
        <div style={{ background: "var(--red-dim)", border: "1px solid var(--red-border)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, color: "var(--red)", marginBottom: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>⚠ {error}</div>
          {error.includes("stale") && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>→ Use Dev Tools → Refresh Oracle, then retry.</div>}
        </div>
      )}

      <button onClick={handle} disabled={!signer || !amount || loading} className="btn"
        style={{
          width: "100%", borderRadius: "var(--radius)", padding: "12px", fontSize: 14, fontWeight: 700,
          background: !signer || !amount || loading ? "var(--surface-3)" : "var(--green-dim)",
          color: !signer || !amount || loading ? "var(--text-3)" : "var(--green)",
          border: `1px solid ${!signer || !amount || loading ? "var(--border)" : "var(--green-border)"}`,
          cursor: !signer || !amount || loading ? "not-allowed" : "pointer",
        }}>
        {loading && <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block" }}>↻</span>}
        {label}
      </button>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", padding: "20px 22px", marginBottom: 20,
  boxShadow: "var(--shadow-card)",
};

const estimate: React.CSSProperties = {
  fontSize: 12, color: "var(--text-2)", marginBottom: 14,
  padding: "8px 12px", background: "var(--surface-2)",
  border: "1px solid var(--border)", borderRadius: "var(--radius)",
};
