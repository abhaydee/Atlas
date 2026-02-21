/**
 * Autonomous Agent Trader
 *
 * Each agent uses the deployer wallet (PRIVATE_KEY) and can autonomously execute
 * every interaction a user performs on-screen:
 *
 *   market-maker  → seeds initial AMM liquidity, provides ongoing LP
 *   arbitrageur   → watches oracle vs AMM price, buys/sells to push them together
 *
 * All activity is broadcast as Server-Sent Events so the frontend can display
 * real-time agent-to-agent interactions.
 */

import { ethers } from "ethers";
import { getWallet } from "./provider.js";
import { getMarket } from "./store.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentRole = "market-maker" | "arbitrageur";

export interface AgentActivity {
  agentId:    string;
  role:       AgentRole;
  marketId:   string;
  assetSymbol: string;
  action:     string;
  detail:     string;
  txHash?:    string;
  timestamp:  string;
  status:     "running" | "success" | "failed" | "info";
}

export interface AgentState {
  id:           string;
  role:         AgentRole;
  marketId:     string;
  assetSymbol:  string;
  address:      string;
  status:       "idle" | "running" | "stopped" | "error";
  activities:   AgentActivity[];
  createdAt:    string;
  lastActionAt?: string;
}

// ── Global registry + SSE broadcast ──────────────────────────────────────────

const _agents      = new Map<string, AgentTrader>();
const _subscribers = new Set<(event: string) => void>();

export function subscribeToAgentActivity(fn: (event: string) => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

function broadcast(activity: AgentActivity): void {
  const data = `data: ${JSON.stringify(activity)}\n\n`;
  for (const fn of _subscribers) { try { fn(data); } catch { /* disconnected */ } }
}

export function getAgent(id: string): AgentTrader | undefined {
  return _agents.get(id);
}

export function getAllAgents(): AgentState[] {
  return Array.from(_agents.values()).map((a) => a.getState());
}

export function stopAllAgentsForMarket(marketId: string): void {
  for (const agent of _agents.values()) {
    if (agent.marketId === marketId) agent.stop();
  }
}

// ── ABI fragments ─────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

const VAULT_ABI = [
  "function mint(uint256 usdcAmount)",
  "function redeem(uint256 syntheticAmount)",
  "function syntheticToken() view returns (address)",
] as const;

const POOL_ABI = [
  "function swapUsdcForSynth(uint256 usdcIn, uint256 minSynthOut) returns (uint256)",
  "function swapSynthForUsdc(uint256 synthIn, uint256 minUsdcOut) returns (uint256)",
  "function addLiquidity(uint256 usdcAmount, uint256 synthAmount) returns (uint256 lpTokens)",
  "function removeLiquidity(uint256 lpAmount) returns (uint256 usdcOut, uint256 synthOut)",
  "function quoteUsdcForSynth(uint256 usdcIn) view returns (uint256 synthOut, uint256 impactBps)",
  "function quoteSynthForUsdc(uint256 synthIn) view returns (uint256 usdcOut, uint256 impactBps)",
  "function getReserves() view returns (uint256 usdcReserve, uint256 synthReserve)",
  "function getPrice() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
] as const;

const ORACLE_ABI = [
  "function getLatestPrice() view returns (uint256)",
] as const;

// ── AgentTrader ───────────────────────────────────────────────────────────────

export class AgentTrader {
  public readonly id:       string;
  public readonly role:     AgentRole;
  public readonly marketId: string;
  public assetSymbol:       string = "";

  private _status:      AgentState["status"] = "idle";
  private _activities:  AgentActivity[]       = [];
  private _loopHandle:  ReturnType<typeof setInterval> | null = null;
  private _usdcBudget:  number;
  public readonly createdAt: string;
  private _lastActionAt?: string;

  constructor(opts: { marketId: string; role: AgentRole; usdcBudget?: number }) {
    this.id          = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.role        = opts.role;
    this.marketId    = opts.marketId;
    this._usdcBudget = opts.usdcBudget ?? 50;
    this.createdAt   = new Date().toISOString();
    _agents.set(this.id, this);
  }

  getState(): AgentState {
    return {
      id:           this.id,
      role:         this.role,
      marketId:     this.marketId,
      assetSymbol:  this.assetSymbol,
      address:      (() => { try { return getWallet().address; } catch { return ""; } })(),
      status:       this._status,
      activities:   this._activities.slice(-100),
      createdAt:    this.createdAt,
      lastActionAt: this._lastActionAt,
    };
  }

  private _emit(activity: Omit<AgentActivity, "agentId" | "role" | "marketId" | "assetSymbol" | "timestamp">): void {
    const event: AgentActivity = {
      ...activity,
      agentId:     this.id,
      role:        this.role,
      marketId:    this.marketId,
      assetSymbol: this.assetSymbol,
      timestamp:   new Date().toISOString(),
    };
    this._activities.push(event);
    this._lastActionAt = event.timestamp;
    broadcast(event);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._status === "running") return;
    this._status = "running";

    const market = getMarket(this.marketId);
    if (!market) {
      this._status = "error";
      this._emit({ action: "error", detail: "Market not found", status: "failed" });
      return;
    }
    this.assetSymbol = market.assetSymbol;

    this._emit({
      action: "spawn",
      detail: `${this.role} agent online for ${market.assetName} (${market.assetSymbol})`,
      status: "info",
    });

    if (this.role === "market-maker") {
      await this._runMarketMakerCycle();
      // Re-check every 5 minutes
      this._loopHandle = setInterval(() => void this._runMarketMakerCycle(), 5 * 60 * 1000);
    } else if (this.role === "arbitrageur") {
      await this._runArbitrageCycle();
      // Check prices every 2 minutes
      this._loopHandle = setInterval(() => void this._runArbitrageCycle(), 2 * 60 * 1000);
    }
  }

  stop(): void {
    if (this._loopHandle) clearInterval(this._loopHandle);
    this._status = "stopped";
    this._emit({ action: "stop", detail: "Agent stopped by operator", status: "info" });
    _agents.delete(this.id);
  }

  // ── Contract accessors ────────────────────────────────────────────────────

  private async _contracts() {
    const market = getMarket(this.marketId);
    if (!market) throw new Error("Market not found");
    const wallet = getWallet();
    return {
      wallet,
      market,
      usdc:   new ethers.Contract(market.contracts.usdc,            ERC20_ABI,  wallet),
      vault:  new ethers.Contract(market.contracts.syntheticVault,  VAULT_ABI,  wallet),
      pool:   market.contracts.synthPool
        ? new ethers.Contract(market.contracts.synthPool, POOL_ABI, wallet)
        : null,
      oracle: new ethers.Contract(market.contracts.oracleReader,    ORACLE_ABI, wallet),
      synth:  new ethers.Contract(market.contracts.syntheticToken,  ERC20_ABI,  wallet),
    };
  }

  // ── Actions (correspond 1:1 to user interactions on-screen) ──────────────

  /**
   * Seed initial AMM liquidity.
   * Equivalent of the user clicking "Seed Pool" in Dev Tools.
   * Splits usdcAmount in half: half → vault (mint synths), half → pool USDC side.
   */
  async seedLiquidity(usdcAmount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { wallet, market, usdc, vault, pool, synth } = await this._contracts();
      if (!pool) throw new Error("No SynthPool for this market");

      const totalRaw  = BigInt(Math.round(usdcAmount * 1e6));
      const vaultHalf = totalRaw / 2n;
      const poolHalf  = totalRaw - vaultHalf;

      const balance: bigint = await usdc.balanceOf(wallet.address) as bigint;
      if (balance < totalRaw) {
        throw new Error(
          `Agent USDC insufficient: has ${(Number(balance) / 1e6).toFixed(2)}, needs ${usdcAmount}`
        );
      }

      this._emit({
        action: "seed-liquidity",
        detail: `Minting ${this.assetSymbol} with ${(Number(vaultHalf)/1e6).toFixed(2)} USDC collateral`,
        status: "running",
      });
      await (await usdc.approve(market.contracts.syntheticVault, vaultHalf) as ethers.ContractTransactionResponse).wait();
      await (await vault.mint(vaultHalf) as ethers.ContractTransactionResponse).wait();

      const synthBalance: bigint = await synth.balanceOf(wallet.address) as bigint;
      if (synthBalance === 0n) throw new Error("No synths minted — oracle may be stale");

      this._emit({
        action: "seed-liquidity",
        detail: `Adding ${(Number(poolHalf)/1e6).toFixed(2)} USDC + ${(Number(synthBalance)/1e18).toFixed(6)} ${this.assetSymbol} to AMM pool`,
        status: "running",
      });
      await (await usdc.approve(market.contracts.synthPool!, poolHalf) as ethers.ContractTransactionResponse).wait();
      await (await synth.approve(market.contracts.synthPool!, synthBalance) as ethers.ContractTransactionResponse).wait();

      const tx      = await pool.addLiquidity(poolHalf, synthBalance) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();

      this._emit({
        action:  "seed-liquidity",
        detail:  `Pool seeded ✓  ${(Number(poolHalf)/1e6).toFixed(2)} USDC + ${(Number(synthBalance)/1e18).toFixed(6)} ${this.assetSymbol}`,
        txHash:  receipt?.hash,
        status:  "success",
      });
      return { success: true, txHash: receipt?.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit({ action: "seed-liquidity", detail: msg, status: "failed" });
      return { success: false, error: msg };
    }
  }

  /**
   * Mint synthetic tokens from the vault.
   * Equivalent of the user filling in "USDC Amount" and clicking "Mint".
   */
  async mint(usdcAmount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { market, usdc, vault } = await this._contracts();
      const raw = BigInt(Math.round(usdcAmount * 1e6));

      this._emit({
        action: "mint",
        detail: `Depositing ${usdcAmount} USDC → vault to mint ${this.assetSymbol}`,
        status: "running",
      });
      await (await usdc.approve(market.contracts.syntheticVault, raw) as ethers.ContractTransactionResponse).wait();
      const tx      = await vault.mint(raw) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();

      this._emit({
        action:  "mint",
        detail:  `Minted ${this.assetSymbol} with ${usdcAmount} USDC collateral`,
        txHash:  receipt?.hash,
        status:  "success",
      });
      return { success: true, txHash: receipt?.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit({ action: "mint", detail: msg, status: "failed" });
      return { success: false, error: msg };
    }
  }

  /**
   * Redeem synthetic tokens back to USDC.
   * Equivalent of the user entering synth amount and clicking "Redeem".
   */
  async redeem(synthAmount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { vault } = await this._contracts();
      const raw = BigInt(Math.round(synthAmount * 1e18));

      this._emit({
        action: "redeem",
        detail: `Redeeming ${synthAmount.toFixed(6)} ${this.assetSymbol} → USDC`,
        status: "running",
      });
      const tx      = await vault.redeem(raw) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();

      this._emit({
        action:  "redeem",
        detail:  `Redeemed ${synthAmount.toFixed(6)} ${this.assetSymbol} for USDC`,
        txHash:  receipt?.hash,
        status:  "success",
      });
      return { success: true, txHash: receipt?.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit({ action: "redeem", detail: msg, status: "failed" });
      return { success: false, error: msg };
    }
  }

  /**
   * Buy synthetic tokens via AMM (go long).
   * Equivalent of the user clicking "Buy xOIL (Long)" in the AMM panel.
   */
  async buyLong(usdcAmount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { market, usdc, pool } = await this._contracts();
      if (!pool) throw new Error("No SynthPool");

      const raw = BigInt(Math.round(usdcAmount * 1e6));
      const [synthOut] = await pool.quoteUsdcForSynth(raw) as [bigint, bigint];
      const minOut     = (synthOut * 95n) / 100n; // 5% slippage tolerance

      this._emit({
        action: "buy-long",
        detail: `Buying ~${(Number(synthOut)/1e18).toFixed(6)} ${this.assetSymbol} with ${usdcAmount.toFixed(2)} USDC`,
        status: "running",
      });
      await (await usdc.approve(market.contracts.synthPool!, raw) as ethers.ContractTransactionResponse).wait();
      const tx      = await pool.swapUsdcForSynth(raw, minOut) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();

      this._emit({
        action:  "buy-long",
        detail:  `Bought ${(Number(synthOut)/1e18).toFixed(6)} ${this.assetSymbol} (long position)`,
        txHash:  receipt?.hash,
        status:  "success",
      });
      return { success: true, txHash: receipt?.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit({ action: "buy-long", detail: msg, status: "failed" });
      return { success: false, error: msg };
    }
  }

  /**
   * Sell synthetic tokens via AMM (exit long).
   * Equivalent of the user clicking "Sell xOIL (Exit)" in the AMM panel.
   */
  async sellLong(synthAmount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { market, synth, pool } = await this._contracts();
      if (!pool) throw new Error("No SynthPool");

      const raw = BigInt(Math.round(synthAmount * 1e18));
      const [usdcOut] = await pool.quoteSynthForUsdc(raw) as [bigint, bigint];
      const minOut    = (usdcOut * 95n) / 100n;

      this._emit({
        action: "sell-long",
        detail: `Selling ${synthAmount.toFixed(6)} ${this.assetSymbol} → USDC`,
        status: "running",
      });
      await (await synth.approve(market.contracts.synthPool!, raw) as ethers.ContractTransactionResponse).wait();
      const tx      = await pool.swapSynthForUsdc(raw, minOut) as ethers.ContractTransactionResponse;
      const receipt = await tx.wait();

      this._emit({
        action:  "sell-long",
        detail:  `Sold ${synthAmount.toFixed(6)} ${this.assetSymbol} → ~${(Number(usdcOut)/1e6).toFixed(4)} USDC`,
        txHash:  receipt?.hash,
        status:  "success",
      });
      return { success: true, txHash: receipt?.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit({ action: "sell-long", detail: msg, status: "failed" });
      return { success: false, error: msg };
    }
  }

  // ── Autonomous decision loops ─────────────────────────────────────────────

  /**
   * Market-maker cycle:
   *   1. If pool is empty and agent has USDC → seed initial liquidity
   *   2. Otherwise → report current pool state
   */
  private async _runMarketMakerCycle(): Promise<void> {
    try {
      const { wallet, usdc, pool } = await this._contracts();
      if (!pool) return;

      const [usdcBal, reserves] = await Promise.all([
        usdc.balanceOf(wallet.address) as Promise<bigint>,
        pool.getReserves()             as Promise<[bigint, bigint]>,
      ]);
      const [usdcRes, synthRes] = reserves;
      const hasLiquidity = usdcRes > 0n && synthRes > 0n;

      const usdcHuman = Number(usdcBal) / 1e6;

      if (!hasLiquidity && usdcHuman < 10) {
        // Cannot seed — wallet is underfunded
        this._emit({
          action: "fund-needed",
          detail: `Agent wallet has ${usdcHuman.toFixed(2)} USDC — needs ≥10 USDC to seed pool. Fund at faucet.gokite.ai`,
          status: "failed",
        });
        return;
      }

      this._emit({
        action: "observe",
        detail: `Wallet USDC: ${usdcHuman.toFixed(2)} | Pool: ${
          hasLiquidity
            ? `${(Number(usdcRes)/1e6).toFixed(2)} USDC / ${(Number(synthRes)/1e18).toFixed(6)} ${this.assetSymbol}`
            : "empty — seeding now…"
        }`,
        status: "info",
      });

      if (!hasLiquidity && usdcHuman >= 10) {
        const seedAmount = Math.min(
          this._usdcBudget,
          usdcHuman * 0.4,
          100
        );
        await this.seedLiquidity(seedAmount);
      }
    } catch (err) {
      this._emit({
        action: "error",
        detail: err instanceof Error ? err.message : String(err),
        status: "failed",
      });
    }
  }

  /**
   * Arbitrageur cycle:
   *   Compares oracle price vs AMM price.
   *   If AMM is cheap  → buy (push AMM price up toward oracle)
   *   If AMM is expensive → sell (push AMM price down toward oracle)
   *   Otherwise → hold
   */
  private async _runArbitrageCycle(): Promise<void> {
    try {
      const { wallet, usdc, synth, pool, oracle } = await this._contracts();
      if (!pool) {
        this._emit({ action: "observe", detail: "No pool — waiting for market maker to seed liquidity", status: "info" });
        return;
      }

      const [oraclePrice, ammPrice, usdcBal, synthBal, reserves] = await Promise.all([
        oracle.getLatestPrice()     as Promise<bigint>,
        pool.getPrice()             as Promise<bigint>,
        usdc.balanceOf(wallet.address)  as Promise<bigint>,
        synth.balanceOf(wallet.address) as Promise<bigint>,
        pool.getReserves()              as Promise<[bigint, bigint]>,
      ]);

      const [usdcRes] = reserves;
      if (usdcRes === 0n) {
        this._emit({ action: "observe", detail: "Pool has no liquidity — waiting for market-maker agent", status: "info" });
        return;
      }

      const oraclePriceF = Number(oraclePrice) / 1e18;
      const ammPriceF    = Number(ammPrice)     / 1e6;
      const usdcAvail    = Number(usdcBal)      / 1e6;
      const synthAvail   = Number(synthBal)      / 1e18;
      const priceDiff    = oraclePriceF > 0 ? (ammPriceF - oraclePriceF) / oraclePriceF : 0;

      this._emit({
        action: "observe",
        detail: `Oracle: $${oraclePriceF.toFixed(4)} | AMM: $${ammPriceF.toFixed(4)} | Spread: ${(priceDiff * 100).toFixed(3)}% | USDC: ${usdcAvail.toFixed(2)} | ${this.assetSymbol}: ${synthAvail.toFixed(6)}`,
        status: "info",
      });

      const THRESHOLD = 0.005; // 0.5% deviation triggers a trade

      if (priceDiff < -THRESHOLD && usdcAvail >= 2) {
        // AMM underpriced relative to oracle → buy to push it up
        const buyAmount = Math.min(usdcAvail * 0.25, this._usdcBudget * 0.15, 15);
        this._emit({
          action: "arb-decision",
          detail: `AMM ${Math.abs(priceDiff * 100).toFixed(2)}% below oracle → buying ${buyAmount.toFixed(2)} USDC of ${this.assetSymbol}`,
          status: "info",
        });
        await this.buyLong(buyAmount);

      } else if (priceDiff > THRESHOLD && synthAvail >= 0.0001) {
        // AMM overpriced relative to oracle → sell to push it down
        const sellAmount = Math.min(synthAvail * 0.25, 0.5);
        this._emit({
          action: "arb-decision",
          detail: `AMM ${(priceDiff * 100).toFixed(2)}% above oracle → selling ${sellAmount.toFixed(6)} ${this.assetSymbol}`,
          status: "info",
        });
        await this.sellLong(sellAmount);

      } else {
        this._emit({
          action: "observe",
          detail: `Prices converged (${(Math.abs(priceDiff)*100).toFixed(3)}% spread) — holding position`,
          status: "info",
        });
      }
    } catch (err) {
      this._emit({
        action: "error",
        detail: err instanceof Error ? err.message : String(err),
        status: "failed",
      });
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function spawnAgent(opts: {
  marketId:    string;
  role:        AgentRole;
  usdcBudget?: number;
}): AgentTrader {
  const agent = new AgentTrader(opts);
  void agent.start();
  return agent;
}
