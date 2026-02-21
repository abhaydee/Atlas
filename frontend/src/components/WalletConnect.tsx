import React from "react";

interface Props {
  address: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WalletConnect({ address, onConnect, onDisconnect }: Props) {
  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {address ? (
        <>
          <div style={connectedPill}>
            <div style={greenDot} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{short}</span>
          </div>
          <button onClick={onDisconnect} style={disconnectBtn}>
            Disconnect
          </button>
        </>
      ) : (
        <button onClick={onConnect} style={connectBtn}>
          Connect Wallet
        </button>
      )}
    </div>
  );
}

const connectedPill: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          7,
  background:   "var(--surface)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "7px 14px",
};

const greenDot: React.CSSProperties = {
  width:        8,
  height:       8,
  borderRadius: "50%",
  background:   "var(--green)",
  boxShadow:    "0 0 5px var(--green)",
  animation:    "pulse 2s infinite",
  flexShrink:   0,
};

const connectBtn: React.CSSProperties = {
  background:   "var(--cta)",
  color:        "#FFFFFF",
  border:       "none",
  borderRadius: "var(--radius)",
  padding:      "8px 18px",
  fontSize:     13,
  fontWeight:   700,
  cursor:       "pointer",
  letterSpacing: "-0.1px",
};

const disconnectBtn: React.CSSProperties = {
  background:   "transparent",
  color:        "var(--muted)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding:      "7px 14px",
  fontSize:     13,
  fontWeight:   500,
  cursor:       "pointer",
};
