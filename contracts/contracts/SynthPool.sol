// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SynthPool
 * @notice Constant-product AMM (x * y = k) for trading synthetic tokens against USDC.
 *
 * This is the LONG side of the protocol:
 *   - SyntheticVault = SHORT side: post USDC collateral, issue synth debt (CDP / Maker style)
 *   - SynthPool      = LONG side:  buy synth with USDC, price appreciates with oracle
 *
 * When a market is created the deployer can bootstrap the pool by minting synths
 * through the vault and depositing them alongside USDC, giving the pool immediate liquidity.
 *
 * Token conventions
 *   usdc  — 6 decimals
 *   synth — 18 decimals
 *   LP    — 18 decimals (this contract, ERC20)
 *
 * Fee: 1% on every swap (remains in pool, accrues to LPs).
 *
 * Swap formula (constant product with fee):
 *   amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
 *   The full amountIn is added to reserves so the fee stays in the pool.
 */
contract SynthPool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IERC20 public immutable synth;

    // Raw on-chain reserves
    uint256 private reserveUsdc;   // 6 decimals
    uint256 private reserveSynth;  // 18 decimals

    uint256 public constant FEE_BPS   = 100;     // 1.00%
    uint256 public constant FEE_DENOM = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event LiquidityAdded(
        address indexed provider,
        uint256 usdcAmount,
        uint256 synthAmount,
        uint256 lpTokens
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256 usdcAmount,
        uint256 synthAmount,
        uint256 lpTokens
    );

    event Swap(
        address indexed trader,
        bool    usdcForSynth,  // true = buy synth (long), false = sell synth (exit long)
        uint256 amountIn,
        uint256 amountOut
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _synth,
        string memory lpName,
        string memory lpSymbol
    ) ERC20(lpName, lpSymbol) {
        require(_usdc  != address(0), "Pool: zero usdc");
        require(_synth != address(0), "Pool: zero synth");
        usdc  = IERC20(_usdc);
        synth = IERC20(_synth);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @return usdcReserve  raw USDC reserve (6 dec)
    /// @return synthReserve raw synth reserve (18 dec)
    function getReserves() external view returns (uint256 usdcReserve, uint256 synthReserve) {
        return (reserveUsdc, reserveSynth);
    }

    /**
     * @notice AMM spot price of 1 synth in USDC.
     * @return price in USDC with 6 decimals (e.g. 1_000_000 = $1.00, 1_000_000_000 = $1000.00).
     *
     * Derivation:
     *   raw ratio = reserveUsdc (6 dec) / reserveSynth (18 dec)
     *   to express in 6-dec USDC we multiply by 1e18:
     *   price = reserveUsdc * 1e18 / reserveSynth  →  6 dec
     */
    function getPrice() external view returns (uint256) {
        if (reserveSynth == 0) return 0;
        return (reserveUsdc * 1e18) / reserveSynth;
    }

    /**
     * @notice Preview: how many synth tokens you receive for `usdcIn`.
     * @return synthOut       Estimated synth out (18 dec).
     * @return priceImpactBps Price impact in basis points (100 = 1%).
     */
    function quoteUsdcForSynth(uint256 usdcIn)
        external
        view
        returns (uint256 synthOut, uint256 priceImpactBps)
    {
        if (reserveUsdc == 0 || reserveSynth == 0 || usdcIn == 0) return (0, 0);
        uint256 usdcInFee = usdcIn * (FEE_DENOM - FEE_BPS) / FEE_DENOM;
        synthOut = (usdcInFee * reserveSynth) / (reserveUsdc + usdcInFee);
        if (synthOut == 0 || synthOut >= reserveSynth) return (0, 10_000);
        uint256 priceBefore = (reserveUsdc * 1e18) / reserveSynth;
        uint256 newUsdc     = reserveUsdc + usdcIn;
        uint256 newSynth    = reserveSynth - synthOut;
        uint256 priceAfter  = (newUsdc * 1e18) / newSynth;
        priceImpactBps = priceAfter > priceBefore
            ? ((priceAfter - priceBefore) * 10_000) / priceBefore
            : 0;
    }

    /**
     * @notice Preview: how many USDC you receive for `synthIn`.
     * @return usdcOut        Estimated USDC out (6 dec).
     * @return priceImpactBps Price impact in basis points.
     */
    function quoteSynthForUsdc(uint256 synthIn)
        external
        view
        returns (uint256 usdcOut, uint256 priceImpactBps)
    {
        if (reserveUsdc == 0 || reserveSynth == 0 || synthIn == 0) return (0, 0);
        uint256 synthInFee = synthIn * (FEE_DENOM - FEE_BPS) / FEE_DENOM;
        usdcOut = (synthInFee * reserveUsdc) / (reserveSynth + synthInFee);
        if (usdcOut == 0 || usdcOut >= reserveUsdc) return (0, 10_000);
        uint256 priceBefore = (reserveUsdc  * 1e18) / reserveSynth;
        uint256 newUsdc     = reserveUsdc   - usdcOut;
        uint256 newSynth    = reserveSynth  + synthIn;
        uint256 priceAfter  = (newUsdc * 1e18) / newSynth;
        priceImpactBps = priceAfter < priceBefore
            ? ((priceBefore - priceAfter) * 10_000) / priceBefore
            : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidity
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC + synth to receive LP tokens.
     *
     * First deposit:
     *   Sets the initial price ratio.
     *   LP minted = sqrt(usdcAmount_18 * synthAmount) where usdcAmount_18 = usdcAmount * 1e12.
     *
     * Subsequent deposits:
     *   Must match the existing ratio.  The binding side is calculated and the other
     *   side is adjusted down (excess stays with the caller — they should pass max amounts).
     *
     * @param usdcAmount  Desired USDC to deposit (6 decimals).
     * @param synthAmount Desired synth to deposit (18 decimals).
     * @return lpTokens LP tokens minted to caller (18 decimals).
     */
    function addLiquidity(uint256 usdcAmount, uint256 synthAmount)
        external
        nonReentrant
        returns (uint256 lpTokens)
    {
        require(usdcAmount > 0 && synthAmount > 0, "Pool: zero amounts");

        uint256 actualUsdc  = usdcAmount;
        uint256 actualSynth = synthAmount;
        uint256 totalLp     = totalSupply();

        if (totalLp > 0) {
            // Enforce current ratio — pick the binding side, trim the other
            uint256 impliedSynth = (usdcAmount * reserveSynth) / reserveUsdc;
            if (impliedSynth <= synthAmount) {
                actualSynth = impliedSynth;
            } else {
                actualUsdc = (synthAmount * reserveUsdc) / reserveSynth;
            }
        }

        usdc.safeTransferFrom(msg.sender, address(this), actualUsdc);
        synth.safeTransferFrom(msg.sender, address(this), actualSynth);

        if (totalLp == 0) {
            // Normalise USDC to 18 decimals before computing geometric mean
            lpTokens = _sqrt(actualUsdc * 1e12 * actualSynth);
        } else {
            lpTokens = (actualUsdc * totalLp) / reserveUsdc;
        }
        require(lpTokens > 0, "Pool: zero LP minted");

        reserveUsdc  += actualUsdc;
        reserveSynth += actualSynth;
        _mint(msg.sender, lpTokens);

        emit LiquidityAdded(msg.sender, actualUsdc, actualSynth, lpTokens);
    }

    /**
     * @notice Burn LP tokens and receive proportional USDC + synth.
     * @param lpAmount LP tokens to burn (18 decimals).
     * @return usdcOut  USDC returned (6 decimals).
     * @return synthOut Synth returned (18 decimals).
     */
    function removeLiquidity(uint256 lpAmount)
        external
        nonReentrant
        returns (uint256 usdcOut, uint256 synthOut)
    {
        require(lpAmount > 0, "Pool: zero LP");
        uint256 totalLp = totalSupply();
        require(lpAmount <= totalLp, "Pool: insufficient LP");

        usdcOut  = (lpAmount * reserveUsdc)  / totalLp;
        synthOut = (lpAmount * reserveSynth) / totalLp;
        require(usdcOut > 0 || synthOut > 0, "Pool: dust removal");

        _burn(msg.sender, lpAmount);
        reserveUsdc  -= usdcOut;
        reserveSynth -= synthOut;

        usdc.safeTransfer(msg.sender,  usdcOut);
        synth.safeTransfer(msg.sender, synthOut);

        emit LiquidityRemoved(msg.sender, usdcOut, synthOut, lpAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Swaps
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Buy synth tokens with USDC — go LONG the oracle-tracked asset.
     * @param usdcIn      USDC to sell (6 decimals).
     * @param minSynthOut Minimum synth to receive — reverts on slippage.
     * @return synthOut Synth tokens received (18 decimals).
     */
    function swapUsdcForSynth(uint256 usdcIn, uint256 minSynthOut)
        external
        nonReentrant
        returns (uint256 synthOut)
    {
        require(usdcIn > 0, "Pool: zero input");
        require(reserveUsdc > 0 && reserveSynth > 0, "Pool: no liquidity");

        // Fee stays in pool (added to reserveUsdc in full)
        uint256 usdcInFee = usdcIn * (FEE_DENOM - FEE_BPS) / FEE_DENOM;
        synthOut = (usdcInFee * reserveSynth) / (reserveUsdc + usdcInFee);

        require(synthOut >= minSynthOut, "Pool: slippage exceeded");
        require(synthOut < reserveSynth, "Pool: insufficient liquidity");

        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        synth.safeTransfer(msg.sender, synthOut);

        reserveUsdc  += usdcIn;     // full amount (fee remains in pool)
        reserveSynth -= synthOut;

        emit Swap(msg.sender, true, usdcIn, synthOut);
    }

    /**
     * @notice Sell synth tokens for USDC — exit long position or take profit.
     * @param synthIn    Synth to sell (18 decimals).
     * @param minUsdcOut Minimum USDC to receive — reverts on slippage.
     * @return usdcOut USDC received (6 decimals).
     */
    function swapSynthForUsdc(uint256 synthIn, uint256 minUsdcOut)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        require(synthIn > 0, "Pool: zero input");
        require(reserveUsdc > 0 && reserveSynth > 0, "Pool: no liquidity");

        uint256 synthInFee = synthIn * (FEE_DENOM - FEE_BPS) / FEE_DENOM;
        usdcOut = (synthInFee * reserveUsdc) / (reserveSynth + synthInFee);

        require(usdcOut >= minUsdcOut, "Pool: slippage exceeded");
        require(usdcOut < reserveUsdc, "Pool: insufficient liquidity");

        synth.safeTransferFrom(msg.sender, address(this), synthIn);
        usdc.safeTransfer(msg.sender, usdcOut);

        reserveSynth += synthIn;    // full amount
        reserveUsdc  -= usdcOut;

        emit Swap(msg.sender, false, synthIn, usdcOut);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    /// Babylonian integer square root.
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
