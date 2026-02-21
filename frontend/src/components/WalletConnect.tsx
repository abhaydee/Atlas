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
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {address ? (
        <>
          <span style={{ color: "var(--green)", fontSize: 14 }}>
            ● {short}
          </span>
          <button onClick={onDisconnect} style={btnStyle("var(--border)")}>
            Disconnect
          </button>
        </>
      ) : (
        <button onClick={onConnect} style={btnStyle("var(--accent)")}>
          Connect Wallet
        </button>
      )}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background:   bg,
    color:        "#fff",
    border:       "none",
    borderRadius: "var(--radius)",
    padding:      "8px 16px",
    cursor:       "pointer",
    fontSize:     14,
  };
}
