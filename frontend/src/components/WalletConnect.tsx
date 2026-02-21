import React from "react";

interface Props {
  address: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WalletConnect({ address, onConnect, onDisconnect }: Props) {
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  if (address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--surface-2)", border: "1px solid var(--border-2)",
          borderRadius: "var(--radius)", padding: "7px 14px",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--green)", boxShadow: "0 0 8px var(--green)",
            animation: "pulse 2s infinite",
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "JetBrains Mono, monospace" }}>{short}</span>
        </div>
        <button onClick={onDisconnect} className="btn btn-ghost btn-sm" style={{ borderRadius: "var(--radius)" }}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={onConnect} className="btn btn-primary" style={{ borderRadius: "var(--radius)", padding: "9px 20px", fontSize: 13 }}>
      Connect Wallet
    </button>
  );
}
