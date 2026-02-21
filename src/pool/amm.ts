/**
 * Uniswap v2-style Constant Product AMM (x * y = k)
 *
 * Two tokens: TOKEN_A (e.g. KITE) and TOKEN_B (e.g. USDT)
 * Fee: 0.3% on every swap input (stays in pool, accrues to LPs)
 * Price: reserveB / reserveA  (how many B per 1 A)
 */

import fs from "fs";
import path from "path";

export interface PoolState {
  reserveA: number;
  reserveB: number;
  totalLiquidity: number; // LP token supply
  feeRate: number;        // 0.003 = 0.3%
  tokenA: string;         // symbol
  tokenB: string;         // symbol
  swapCount: number;
  volumeA: number;        // cumulative A volume
  volumeB: number;        // cumulative B volume
  feesCollectedA: number; // AMM fees that stayed in pool (A)
  feesCollectedB: number; // AMM fees that stayed in pool (B)
  createdAt: string;
  lastUpdated: string;
}

export interface SwapResult {
  tokenIn: "A" | "B";
  amountIn: number;
  amountOut: number;
  feeCharged: number;   // fee portion of amountIn
  priceImpact: number;  // fraction, e.g. 0.02 = 2%
  newPrice: number;     // new price after swap
  newReserveA: number;
  newReserveB: number;
}

export interface LiquidityResult {
  amountA: number;
  amountB: number;
  lpTokensMinted: number;
  newReserveA: number;
  newReserveB: number;
  newTotalLiquidity: number;
}

export interface RemoveLiquidityResult {
  lpTokensBurned: number;
  amountAReturned: number;
  amountBReturned: number;
  newReserveA: number;
  newReserveB: number;
  newTotalLiquidity: number;
}

const STATE_FILE = path.resolve("pool-state.json");

const DEFAULT_STATE: PoolState = {
  reserveA: 10_000,
  reserveB: 10_000,
  totalLiquidity: 10_000, // geometric mean of initial reserves
  feeRate: 0.003,
  tokenA: "KITE",
  tokenB: "USDT",
  swapCount: 0,
  volumeA: 0,
  volumeB: 0,
  feesCollectedA: 0,
  feesCollectedB: 0,
  createdAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
};

export class AMM {
  private state: PoolState;

  constructor(initialState?: Partial<PoolState>) {
    this.state = this.loadState(initialState);
  }

  // ── Read-only ─────────────────────────────────────────────────────────────

  getState(): Readonly<PoolState> {
    return { ...this.state };
  }

  /** Price of TOKEN_A in terms of TOKEN_B (how many B per 1 A) */
  getPrice(): number {
    return this.state.reserveB / this.state.reserveA;
  }

  /** Spot price of TOKEN_B in terms of TOKEN_A */
  getPriceInverse(): number {
    return this.state.reserveA / this.state.reserveB;
  }

  /** Invariant k = x * y */
  getInvariant(): number {
    return this.state.reserveA * this.state.reserveB;
  }

  /** Preview a swap without executing it */
  previewSwap(tokenIn: "A" | "B", amountIn: number): SwapResult {
    return this.calcSwap(tokenIn, amountIn, this.state);
  }

  /** Price impact as a fraction for a given swap */
  getPriceImpact(tokenIn: "A" | "B", amountIn: number): number {
    return this.calcSwap(tokenIn, amountIn, this.state).priceImpact;
  }

  // ── Mutating ──────────────────────────────────────────────────────────────

  swap(tokenIn: "A" | "B", amountIn: number): SwapResult {
    if (amountIn <= 0) throw new Error("amountIn must be > 0");

    const result = this.calcSwap(tokenIn, amountIn, this.state);

    if (result.amountOut <= 0) throw new Error("Insufficient liquidity");
    if (result.amountOut >= (tokenIn === "A" ? this.state.reserveB : this.state.reserveA)) {
      throw new Error("Not enough reserve to fulfill swap");
    }

    this.state.reserveA = result.newReserveA;
    this.state.reserveB = result.newReserveB;
    this.state.swapCount++;

    if (tokenIn === "A") {
      this.state.volumeA += amountIn;
      this.state.feesCollectedA += result.feeCharged;
    } else {
      this.state.volumeB += amountIn;
      this.state.feesCollectedB += result.feeCharged;
    }

    this.state.lastUpdated = new Date().toISOString();
    this.saveState();
    return result;
  }

  addLiquidity(amountA: number, amountB: number): LiquidityResult {
    if (amountA <= 0 || amountB <= 0) throw new Error("Amounts must be > 0");

    let actualA = amountA;
    let actualB = amountB;

    if (this.state.totalLiquidity > 0) {
      // Maintain current ratio
      const ratio = this.state.reserveA / this.state.reserveB;
      const impliedB = amountA / ratio;
      if (impliedB <= amountB) {
        actualB = impliedB;
      } else {
        actualA = amountB * ratio;
      }
    }

    // LP tokens proportional to contribution
    const lpMinted =
      this.state.totalLiquidity === 0
        ? Math.sqrt(actualA * actualB) // geometric mean for first deposit
        : (actualA / this.state.reserveA) * this.state.totalLiquidity;

    this.state.reserveA += actualA;
    this.state.reserveB += actualB;
    this.state.totalLiquidity += lpMinted;
    this.state.lastUpdated = new Date().toISOString();
    this.saveState();

    return {
      amountA: actualA,
      amountB: actualB,
      lpTokensMinted: lpMinted,
      newReserveA: this.state.reserveA,
      newReserveB: this.state.reserveB,
      newTotalLiquidity: this.state.totalLiquidity,
    };
  }

  removeLiquidity(lpTokens: number): RemoveLiquidityResult {
    if (lpTokens <= 0) throw new Error("lpTokens must be > 0");
    if (lpTokens > this.state.totalLiquidity) throw new Error("Not enough LP tokens");

    const share = lpTokens / this.state.totalLiquidity;
    const amountA = share * this.state.reserveA;
    const amountB = share * this.state.reserveB;

    this.state.reserveA -= amountA;
    this.state.reserveB -= amountB;
    this.state.totalLiquidity -= lpTokens;
    this.state.lastUpdated = new Date().toISOString();
    this.saveState();

    return {
      lpTokensBurned: lpTokens,
      amountAReturned: amountA,
      amountBReturned: amountB,
      newReserveA: this.state.reserveA,
      newReserveB: this.state.reserveB,
      newTotalLiquidity: this.state.totalLiquidity,
    };
  }

  /** Reset pool to initial state (owner only). */
  reset(initialReserveA = 10_000, initialReserveB = 10_000): void {
    this.state = {
      ...DEFAULT_STATE,
      reserveA: initialReserveA,
      reserveB: initialReserveB,
      totalLiquidity: Math.sqrt(initialReserveA * initialReserveB),
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    this.saveState();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private calcSwap(tokenIn: "A" | "B", amountIn: number, s: PoolState): SwapResult {
    const { reserveA, reserveB, feeRate } = s;
    const fee = amountIn * feeRate;
    const amountInAfterFee = amountIn - fee;

    let amountOut: number;
    let newReserveA: number;
    let newReserveB: number;

    if (tokenIn === "A") {
      // Selling A, buying B
      // amountOut = reserveB - k / (reserveA + amountInAfterFee)
      const k = reserveA * reserveB;
      newReserveA = reserveA + amountInAfterFee;
      newReserveB = k / newReserveA;
      amountOut = reserveB - newReserveB;
    } else {
      // Selling B, buying A
      const k = reserveA * reserveB;
      newReserveB = reserveB + amountInAfterFee;
      newReserveA = k / newReserveB;
      amountOut = reserveA - newReserveA;
    }

    const priceBefore = reserveB / reserveA;
    const priceAfter = newReserveB / newReserveA;
    const priceImpact = Math.abs(priceAfter - priceBefore) / priceBefore;

    return {
      tokenIn,
      amountIn,
      amountOut,
      feeCharged: fee,
      priceImpact,
      newPrice: priceAfter,
      newReserveA,
      newReserveB,
    };
  }

  private loadState(overrides?: Partial<PoolState>): PoolState {
    if (overrides && Object.keys(overrides).length > 0) {
      return { ...DEFAULT_STATE, ...overrides };
    }
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        return JSON.parse(raw) as PoolState;
      }
    } catch {
      // Fall through to default
    }
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch {
      // Non-fatal — state lives in memory
    }
  }
}
