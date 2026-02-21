import React, { useState } from "react";
import { ethers } from "ethers";
import { SYNTHETIC_VAULT_ABI, ERC20_ABI } from "../lib/abis.ts";

interface Props {
  vaultAddress: string; usdcAddress: string; oraclePrice: string;
  assetSymbol: string; signer: ethers.JsonRpcSigner | null; onSuccess: () => void;
}

export function MintForm({ vaultAddress, usdcAddress, oraclePrice, assetSymbol, signer, onSuccess }: Props) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "approving" | "minting">("idle");
  const [error,  setError]  = useState<string | null>(null);

  const COLLATERAL_RATIO = 1.5; // must match contract (15n * 10n**17n)
  const MINT_FEE_BPS     = 50;  // must match contract constant
  const price        = parseFloat(oraclePrice) || 0;
  const inputUsdc    = parseFloat(amount) || 0;
  const feeUsdc      = (inputUsdc * MINT_FEE_BPS) / 10_000;
  const usdcForSynth = inputUsdc - feeUsdc;
  const estSynth     = price > 0 ? usdcForSynth / (price * COLLATERAL_RATIO) : 0;
  const busy         = status !== "idle";

  async function handle() {
    if (!signer || !amount || parseFloat(amount) <= 0) return;
    setError(null);
    try {
      const usdc  = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
      const vault = new ethers.Contract(vaultAddress, SYNTHETIC_VAULT_ABI, signer);
      const dec: bigint  = await usdc.decimals();
      const big  = ethers.parseUnits(amount, dec);
      const user = await signer.getAddress();
      const allow: bigint = await usdc.allowance(user, vaultAddress);
      if (allow < big) {
        setStatus("approving");
        await (await usdc.approve(vaultAddress, big) as ethers.ContractTransactionResponse).wait();
      }
      setStatus("minting");
      await (await vault.mint(big) as ethers.ContractTransactionResponse).wait();
      setAmount(""); setStatus("idle"); onSuccess();
    } catch (err) {
      setError(parseErr(err)); setStatus("idle");
    }
  }

  const label = status === "approving" ? "Approving USDC…" : status === "minting" ? "Minting…" : !signer ? "Connect Wallet" : "Approve & Mint";

  return (
    <div style={card}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 4 }}>
          Mint <span style={{ color: "var(--accent)" }}>[ {assetSymbol} ]</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Deposit USDC → receive synthetic tokens (short the asset)</div>
      </div>

      <Label>USDC Amount</Label>
      <input className="field-input" type="number" min="0" step="any" placeholder="0.00"
        value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy}
        style={{ marginBottom: 8 }}
      />

      {price > 0 && inputUsdc > 0 && (
        <div style={estimate}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "var(--text-3)" }}>Mint fee (0.5%)</span>
            <span style={{ color: "var(--gold)", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
              −${feeUsdc.toFixed(4)} USDC
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "var(--text-3)" }}>Collateral deposited</span>
            <span style={{ color: "var(--text-2)", fontFamily: "JetBrains Mono, monospace" }}>
              ${usdcForSynth.toFixed(4)} USDC
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-2)", fontWeight: 600 }}>You receive</span>
            <span style={{ color: "var(--text)", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
              {estSynth.toFixed(6)} {assetSymbol}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 5 }}>
            Fee stays in vault as surplus collateral · enables arb redemptions
          </div>
        </div>
      )}

      {error && <ErrorBox msg={error} hint={
        error.includes("stale") ? "Stale oracle — use Dev Tools → Refresh Oracle, then retry." :
        error.includes("USDC") || error.includes("balance") ? "Get testnet USDC at faucet.gokite.ai" : undefined
      } />}

      <button onClick={handle} disabled={!signer || !amount || busy} className="btn btn-primary"
        style={{ width: "100%", borderRadius: "var(--radius)", padding: "12px", fontSize: 14 }}>
        {busy && <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block" }}>↻</span>}
        {label}
      </button>
    </div>
  );
}

function parseErr(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/user rejected|ACTION_REJECTED/i.test(raw)) return "Transaction cancelled.";
  if (/stale/i.test(raw)) return "Oracle price is stale (>2h old). Refresh oracle via Dev Tools.";
  if (/too small/i.test(raw)) return "Amount too small — try a larger value.";
  if (/undercollateral/i.test(raw)) return "Vault undercollateralised — oracle may be stale. Refresh oracle in Dev Tools.";
  if (/insufficient balance|transfer amount exceeds/i.test(raw)) return "Insufficient USDC balance.";
  if (/insufficient allowance/i.test(raw)) return "Approval failed — try again.";
  const m = raw.match(/reason="([^"]+)"|revert reason: ([^\n]+)|execution reverted: ([^\n"]+)/i);
  if (m) return m[1] ?? m[2] ?? m[3] ?? raw;
  return raw.slice(0, 200);
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 7 }}>{children}</div>;
}

function ErrorBox({ msg, hint }: { msg: string; hint?: string }) {
  return (
    <div style={{ background: "var(--red-dim)", border: "1px solid var(--red-border)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, color: "var(--red)", marginBottom: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700 }}>⚠ {msg}</div>
      {hint && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>→ {hint}</div>}
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
