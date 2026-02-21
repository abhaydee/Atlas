/**
 * ProgressTimeline — real-time market creation progress via SSE.
 * Connects to GET /job/:id/stream and renders each step.
 */

import React, { useEffect, useRef, useState } from "react";

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface JobStep {
  name:       string;
  label:      string;
  status:     StepStatus;
  txHash?:    string;
  detail?:    string;
  startedAt?: string;
  doneAt?:    string;
}

export interface PaymentLog {
  action:       string;
  amountRaw:    string;
  amountHuman:  string;
  tokenAddress: string;
  payTo:        string;
  agentAddress: string;
  txHash?:      string;
  status:       "pending" | "success" | "failed";
  error?:       string;
  timestamp:    string;
}

export interface DeployedContracts {
  syntheticToken:   string;
  oracleReader:     string;
  syntheticVault:   string;
  oracleAggregator: string;
  mockOracle:       string | null;
  usdc:             string;
  synthPool:        string;
}

export interface JobMarket {
  id:           string;
  assetName:    string;
  assetSymbol:  string;
  contracts:    DeployedContracts;
  paymentLog?:  PaymentLog;
  createdAt:    string;
}

export interface JobRecord {
  id:          string;
  status:      "running" | "success" | "failed";
  steps:       JobStep[];
  paymentLog?: PaymentLog;
  market?:     JobMarket;
  error?:      string;
  createdAt:   string;
  updatedAt:   string;
}

const KITE_EXPLORER = "https://testnet.kitescan.ai";

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={`${KITE_EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      style={{ fontSize: 11, fontFamily: "monospace", color: "var(--accent)", textDecoration: "none", marginLeft: 6 }}
    >
      {hash.slice(0, 10)}…{hash.slice(-6)} ↗
    </a>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  const icons: Record<StepStatus, string> = {
    pending: "○",
    running: "◌",
    success: "✓",
    failed:  "✗",
    skipped: "–",
  };
  const colors: Record<StepStatus, string> = {
    pending: "var(--muted)",
    running: "var(--accent)",
    success: "var(--green)",
    failed:  "var(--red)",
    skipped: "var(--muted)",
  };
  return (
    <span style={{ color: colors[status], fontWeight: 700, fontSize: 16, minWidth: 20, display: "inline-block", textAlign: "center" }}>
      {status === "running" ? <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span> : icons[status]}
    </span>
  );
}

export function ProgressTimeline({
  jobId,
  backendUrl,
  onComplete,
  onFail,
}: {
  jobId:       string;
  backendUrl:  string;
  onComplete?: (job: JobRecord) => void;
  onFail?:     (error: string) => void;
}) {
  const [job,        setJob]        = useState<JobRecord | null>(null);
  const [connected,  setConnected]  = useState(false);
  const esRef                       = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const es = new EventSource(`${backendUrl}/job/${jobId}/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as JobRecord;
        setJob(data);
        if (data.status === "success") {
          es.close();
          onComplete?.(data);
        } else if (data.status === "failed") {
          es.close();
          onFail?.(data.error ?? "Unknown error");
        }
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      setConnected(false);
      // Fall back to polling if SSE fails
      es.close();
    };

    return () => { es.close(); };
  }, [jobId, backendUrl, onComplete, onFail]);

  if (!job) {
    return (
      <div style={card}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Connecting to agent stream…</div>
      </div>
    );
  }

  const activeSteps = job.steps.filter((s) => s.name !== "done");

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 14 }}>
          Agent Progress
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {connected && job.status === "running" && (
            <span style={{ fontSize: 11, color: "var(--green)" }}>● Live</span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
            background: job.status === "success" ? "rgba(52,199,89,0.15)" :
                        job.status === "failed"  ? "rgba(255,69,58,0.15)"  : "rgba(108,99,255,0.15)",
            color: job.status === "success" ? "var(--green)" :
                   job.status === "failed"  ? "var(--red)"   : "var(--accent)",
          }}>
            {job.status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activeSteps.map((step, i) => (
          <div key={step.name} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            {/* Connector line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <StatusIcon status={step.status} />
              {i < activeSteps.length - 1 && (
                <div style={{ width: 1, flex: 1, minHeight: 12, background: "var(--border)", margin: "2px 0" }} />
              )}
            </div>
            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: step.status === "running" ? 700 : 500,
                  color: step.status === "success" ? "var(--text)" :
                         step.status === "failed"  ? "var(--red)"   :
                         step.status === "running" ? "var(--accent)" : "var(--muted)",
                }}>
                  {step.label}
                </span>
                {step.txHash && <TxLink hash={step.txHash} />}
              </div>
              {step.detail && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontFamily: step.detail.startsWith("0x") ? "monospace" : undefined }}>
                  {step.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Payment log */}
      {job.paymentLog && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>💳</span>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              x402 Payment Log
            </div>
            <span style={{
              marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
              background: job.paymentLog.status === "success" ? "var(--green-light)" : "var(--red-light)",
              color:      job.paymentLog.status === "success" ? "var(--green)"       : "var(--red)",
              border:     `1px solid ${job.paymentLog.status === "success" ? "var(--green)" : "var(--red)"}`,
            }}>
              {job.paymentLog.status.toUpperCase()}
            </span>
          </div>
          <PaymentLogRow label="Agent Wallet" value={`${job.paymentLog.agentAddress.slice(0, 10)}…${job.paymentLog.agentAddress.slice(-8)}`} mono />
          <PaymentLogRow label="Amount"       value={job.paymentLog.amountHuman} highlight />
          <PaymentLogRow label="Pay To"       value={`${job.paymentLog.payTo.slice(0, 10)}…${job.paymentLog.payTo.slice(-8)}`} mono />
          <PaymentLogRow label="Status"       value={job.paymentLog.status}
            statusColor={job.paymentLog.status === "success" ? "var(--green)" : job.paymentLog.status === "failed" ? "var(--red)" : "var(--muted)"} />
          {job.paymentLog.txHash && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span style={{ color: "var(--muted)" }}>Tx Hash</span>
              <TxLink hash={job.paymentLog.txHash} />
            </div>
          )}
          {job.paymentLog.error && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--red)" }}>{job.paymentLog.error}</div>
          )}
        </div>
      )}

      {/* Error */}
      {job.status === "failed" && job.error && (
        <div style={{ marginTop: 12, background: "var(--red-light)", border: "1px solid var(--red)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, color: "var(--red)", lineHeight: 1.5 }}>
          <strong>⚠ {job.error}</strong>
          {(job.error.includes("insufficient") || job.error.includes("balance")) && (
            <div style={{ marginTop: 5, fontSize: 11 }}>
              Action: Top up the agent wallet with testnet USDT at{" "}
              <a href="https://faucet.gokite.ai" target="_blank" rel="noreferrer" style={{ color: "var(--red)", fontWeight: 700 }}>faucet.gokite.ai</a>
            </div>
          )}
          {job.error.includes("cap") && (
            <div style={{ marginTop: 5, fontSize: 11 }}>
              Action: Daily spending cap reached — wait for UTC midnight reset or increase AGENT_DAILY_CAP in .env
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentLogRow({
  label, value, mono = false, highlight = false, statusColor,
}: {
  label:        string;
  value:        string;
  mono?:        boolean;
  highlight?:   boolean;
  statusColor?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{
        fontFamily:  mono      ? "monospace" : undefined,
        color:       statusColor ?? (highlight ? "var(--green)" : "var(--text)"),
        fontWeight:  highlight ? 700         : undefined,
        fontSize:    mono      ? 11          : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background:   "var(--surface-2)",
  border:       "1px solid var(--border-2)",
  borderRadius: "var(--radius-lg)",
  padding:      "18px 22px",
  marginBottom: 16,
  boxShadow:    "var(--shadow-card)",
};
