/**
 * Oracle Job Runner — fetches prices and posts them to OracleAggregator on-chain.
 *
 * Price resolution order (for each data source):
 *   1. Pyth Network (if pythFeedId present) — aggregated, manipulation-resistant, ~400ms updates
 *   2. Dynamic Pyth search (if type === "pyth" but no pythFeedId) — runtime feed discovery
 *   3. URL + JSONPath fallback — for assets not available on Pyth
 *
 * Mimics Switchboard's flow:
 *   Fetch price → scale to oracle decimals → call aggregator.updatePrice(price) on-chain.
 */

import { ethers } from "ethers";
import type { ResearchResult } from "./agent.js";
import { fetchPythPrice, getPythPrice } from "./pyth-provider.js";
import dotenv from "dotenv";
import { getWallet } from "./provider.js";
dotenv.config();

/** Minimal ABI for OracleAggregator.updatePrice(int256) */
const ORACLE_AGGREGATOR_ABI = [
  "function updatePrice(int256 newPrice) external",
] as const;

/** Simple JSONPath for $.a.b.c — returns value at path or null */
function extractByPath(obj: unknown, pathStr: string): number | null {
  if (!pathStr.startsWith("$.")) return null;
  const keys = pathStr.slice(2).split(".");
  let current: unknown = obj;
  for (const k of keys) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[k];
  }
  if (typeof current === "number") return current;
  if (typeof current === "string") return parseFloat(current) || null;
  return null;
}

async function fetchPrice(url: string, jsonPath: string): Promise<number | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return extractByPath(json, jsonPath);
  } catch {
    return null;
  }
}

/** Minimal shape needed for oracle update. pythFeedId takes priority over url+jsonPath. */
export interface OracleJobSpec {
  dataSources?: Array<{
    pythFeedId?: string;
    pythSymbol?: string;
    type?: string;
    url?: string;
    jsonPath?: string;
    name?: string;
  }>;
}

export interface RunnerConfig {
  aggregatorAddress: string;
  research: ResearchResult | OracleJobSpec;
  decimals?: number;   // scale price to (e.g. 8 for Chainlink-style)
  assetName?: string;  // used for dynamic Pyth search when no pythFeedId is stored
  /** If set, skip fetch and use this price for the update (used after dry-run + vault check). */
  usePrice?: { price: number; source: string };
  /** If true, only fetch price and return it without calling updatePrice on-chain. */
  skipUpdate?: boolean;
}

/**
 * Run one oracle update: fetch from best data source, post to aggregator.
 *
 * Tries sources in order until a valid price is obtained:
 *   1. Pyth via hardcoded pythFeedId
 *   2. Pyth via dynamic feed search (when type === "pyth" but feedId missing)
 *   3. URL + JSONPath fallback
 */
export async function runOracleUpdate(config: RunnerConfig): Promise<{
  success: boolean;
  price?: number;
  source?: string;
  error?: string;
}> {
  const { aggregatorAddress, research, decimals = 8, assetName, usePrice, skipUpdate } = config;
  const sources = research.dataSources ?? [];

  let price: number | null = usePrice ? usePrice.price : null;
  let sourceName = usePrice ? usePrice.source : "unknown";

  if (usePrice) {
    if (skipUpdate) return { success: true, price: usePrice.price, source: usePrice.source };
  } else for (const src of sources) {
    // ── 1. Pyth via explicit feed ID ────────────────────────────────────────
    if (src.pythFeedId) {
      const pythPrice = await fetchPythPrice(src.pythFeedId);
      if (pythPrice !== null && pythPrice > 0) {
        price      = pythPrice;
        sourceName = `Pyth Network — ${src.pythSymbol ?? src.pythFeedId.slice(0, 8)}`;
        console.log(`[oracle-runner] Pyth: $${price.toFixed(4)} from ${sourceName}`);
        break;
      }
      console.warn(`[oracle-runner] Pyth feed ${src.pythFeedId.slice(0, 8)} returned null — trying next source`);
    }

    // ── 2. Dynamic Pyth search (type pyth but no feedId stored yet) ─────────
    if (!src.pythFeedId && src.type === "pyth" && src.name) {
      const result = await getPythPrice(src.name);
      if (result !== null) {
        price      = result.price;
        sourceName = `Pyth Network — ${result.symbol} (dynamic)`;
        console.log(`[oracle-runner] Pyth (dynamic): $${price.toFixed(4)} from ${sourceName}`);
        break;
      }
    }

    // ── 3. URL + JSONPath fallback ───────────────────────────────────────────
    if (src.url && src.jsonPath) {
      const fallbackPrice = await fetchPrice(src.url, src.jsonPath);
      if (fallbackPrice !== null && fallbackPrice > 0) {
        price      = fallbackPrice;
        sourceName = src.name ?? src.url;
        console.log(`[oracle-runner] URL fallback: $${price.toFixed(4)} from ${sourceName}`);
        break;
      }
      console.warn(`[oracle-runner] URL fallback ${src.url} returned null — trying next source`);
    }
  }

  // ── 4. Last resort: dynamic Pyth search by asset name ──────────────────────
  if ((price == null || price <= 0) && assetName) {
    const result = await getPythPrice(assetName);
    if (result !== null) {
      price      = result.price;
      sourceName = `Pyth Network — ${result.symbol} (name lookup)`;
      console.log(`[oracle-runner] Pyth (name lookup): $${price.toFixed(4)} for "${assetName}" → ${result.symbol}`);
    }
  }

  if (price == null || price <= 0) {
    return { success: false, error: "All data sources failed to return a valid price" };
  }

  if (skipUpdate) {
    return { success: true, price, source: sourceName };
  }

  // Scale to oracle decimals (e.g. 8)
  const scaledBigInt = BigInt(Math.round(price * 10 ** decimals));

  try {
    const wallet = getWallet();
    const aggregator = new ethers.Contract(aggregatorAddress, ORACLE_AGGREGATOR_ABI, wallet);
    const tx = await aggregator.updatePrice(scaledBigInt);
    await (tx as ethers.ContractTransactionResponse).wait();
    return { success: true, price, source: sourceName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
