/**
 * In-memory multi-market store.
 * Multiple markets can be active simultaneously — each has a unique ID.
 */

import type { PaymentLog } from "./agent-signer.js";

export type { PaymentLog };

// ── Market types ──────────────────────────────────────────────────────────────

export interface FeeAllocation {
  totalPayment:     number;
  researchFee:      number;
  oracleFunding:    number;
  deploymentBuffer: number;
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

export interface MarketRecord {
  id:               string;
  assetName:        string;
  assetSymbol:      string;
  assetDescription: string;
  research:         unknown;
  contracts:        DeployedContracts;
  feeAllocation:    FeeAllocation;
  paymentLog?:      PaymentLog;
  createdAt:        string;
}

// ── Job types ─────────────────────────────────────────────────────────────────

export type JobStepName =
  | "payment"
  | "research"
  | "deploy_oracle"
  | "deploy_token"
  | "deploy_vault"
  | "deploy_pool"
  | "oracle_update"
  | "seed_pool"
  | "spawn_agents"
  | "done";

export type JobStepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface JobStep {
  name:       JobStepName;
  label:      string;
  status:     JobStepStatus;
  txHash?:    string;
  detail?:    string;
  startedAt?: string;
  doneAt?:    string;
}

export type JobStatus = "running" | "success" | "failed";

export interface JobRecord {
  id:          string;
  status:      JobStatus;
  steps:       JobStep[];
  paymentLog?: PaymentLog;
  market?:     MarketRecord;
  error?:      string;
  createdAt:   string;
  updatedAt:   string;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

type SseEmitter = (data: string) => void;
const sseSubscribers = new Map<string, Set<SseEmitter>>();

export function subscribeToJob(jobId: string, emit: SseEmitter): () => void {
  if (!sseSubscribers.has(jobId)) sseSubscribers.set(jobId, new Set());
  sseSubscribers.get(jobId)!.add(emit);
  return () => sseSubscribers.get(jobId)?.delete(emit);
}

function broadcastJob(job: JobRecord): void {
  const subs = sseSubscribers.get(job.id);
  if (!subs) return;
  const msg = `data: ${JSON.stringify(job)}\n\n`;
  for (const emit of subs) { try { emit(msg); } catch { /* disconnected */ } }
}

// ── Multi-market store ────────────────────────────────────────────────────────

const marketsMap = new Map<string, MarketRecord>();

/** Add or update a market. */
export function addMarket(market: MarketRecord): void {
  marketsMap.set(market.id, market);
}

/** Get a specific market by ID, or null. */
export function getMarket(id: string): MarketRecord | null {
  return marketsMap.get(id) ?? null;
}

/** Get all markets sorted newest first. */
export function getAllMarkets(): MarketRecord[] {
  return [...marketsMap.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Remove a market by ID. */
export function removeMarket(id: string): boolean {
  return marketsMap.delete(id);
}

/** True if any market exists. */
export function hasMarkets(): boolean {
  return marketsMap.size > 0;
}

// ── Legacy compat (single-market callers) ─────────────────────────────────────

/** @deprecated Use addMarket() */
export function setMarket(market: MarketRecord | null): void {
  if (market) marketsMap.set(market.id, market);
}

/** Returns the most recently created market, or null. */
export function getLatestMarket(): MarketRecord | null {
  const all = getAllMarkets();
  return all[0] ?? null;
}

// ── Fee split ─────────────────────────────────────────────────────────────────

export function splitFee(totalPayment: number): FeeAllocation {
  return {
    totalPayment,
    researchFee:      totalPayment * 0.40,
    oracleFunding:    totalPayment * 0.40,
    deploymentBuffer: totalPayment * 0.20,
  };
}

// ── Job store ─────────────────────────────────────────────────────────────────

const jobs = new Map<string, JobRecord>();

const STEP_LABELS: Record<JobStepName, string> = {
  payment:       "x402 Payment",
  research:      "AI Research",
  deploy_oracle: "Deploy OracleAggregator",
  deploy_token:  "Deploy SyntheticToken",
  deploy_vault:  "Deploy SyntheticVault",
  deploy_pool:   "Deploy SynthPool",
  oracle_update: "Initialize Oracle Price",
  seed_pool:     "Seed AMM Liquidity",
  spawn_agents:  "Spawn AI Agents",
  done:          "Market Live",
};

export function createJob(id: string): JobRecord {
  const steps: JobStep[] = (
    [
      "payment", "research",
      "deploy_oracle", "deploy_token", "deploy_vault", "deploy_pool",
      "oracle_update", "seed_pool", "spawn_agents", "done",
    ] as JobStepName[]
  ).map((name) => ({ name, label: STEP_LABELS[name], status: "pending" as JobStepStatus }));

  const job: JobRecord = {
    id, status: "running", steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function updateJobStep(
  job: JobRecord,
  stepName: JobStepName,
  patch: Partial<Omit<JobStep, "name" | "label">>
): void {
  const step = job.steps.find((s) => s.name === stepName);
  if (!step) return;
  if (patch.status === "running"  && !step.startedAt) patch.startedAt = new Date().toISOString();
  if ((patch.status === "success" || patch.status === "failed") && !patch.doneAt)
    patch.doneAt = new Date().toISOString();
  Object.assign(step, patch);
  job.updatedAt = new Date().toISOString();
  broadcastJob(job);
}

export function failJob(job: JobRecord, error: string): void {
  job.status    = "failed";
  job.error     = error;
  job.updatedAt = new Date().toISOString();
  for (const step of job.steps) {
    if (step.status === "running") { step.status = "failed"; step.doneAt = new Date().toISOString(); }
  }
  broadcastJob(job);
}

export function completeJob(job: JobRecord, market: MarketRecord): void {
  job.status    = "success";
  job.market    = market;
  job.updatedAt = new Date().toISOString();
  updateJobStep(job, "done", { status: "success" });
}
