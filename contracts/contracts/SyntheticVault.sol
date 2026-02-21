// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SyntheticToken.sol";
import "./OracleReader.sol";

/**
 * @title SyntheticVault
 * @notice Collateral-backed vault for minting and redeeming synthetic tokens.
 *
 * Decimal conventions:
 *   USDC            — 6 decimals
 *   SyntheticToken  — 18 decimals
 *   oraclePrice     — 1e18 scale  (e.g. $1000 = 1000 * 1e18)
 *   collateralRatio — 1e18 scale  (1e18 = 100%)
 *
 * Collateral invariant (must hold after every state change):
 *   vaultBalance (USDC, 6 dec) * 1e12  >=
 *   totalSupply * oraclePrice / 1e18 * collateralRatio / 1e18
 *
 * Mint fee:
 *   MINT_FEE_BPS of every deposit is retained in the vault as surplus
 *   collateral rather than backing synths. This builds an excess-collateral
 *   buffer that:
 *     1. Keeps the vault solvent even when the oracle price rises quickly.
 *     2. Makes the arb trade (buy cheap from AMM → redeem at oracle) reliably
 *        profitable: the buffer ensures there is always enough USDC to pay out
 *        the oracle-price redemption after the cheap AMM buy.
 */
contract SyntheticVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    SyntheticToken public immutable syntheticToken;
    OracleReader   public immutable oracleReader;
    IERC20         public immutable usdc;

    /// @notice 1e18 == 100% collateralisation required.
    uint256 public collateralRatio;

    /// @notice Mint fee in basis points. 50 = 0.5%.
    uint256 public constant MINT_FEE_BPS = 50;

    /// @notice Cumulative USDC fees retained as excess collateral (6 decimals).
    uint256 public accumulatedFees;

    event Minted(address indexed user, uint256 usdcIn, uint256 synthOut);
    event Redeemed(address indexed user, uint256 synthIn, uint256 usdcOut);
    event FeeCollected(address indexed user, uint256 feeUsdc);

    constructor(
        address _syntheticToken,
        address _oracleReader,
        address _usdc,
        uint256 _collateralRatio
    ) {
        require(_syntheticToken != address(0), "Vault: zero synth");
        require(_oracleReader   != address(0), "Vault: zero oracle");
        require(_usdc           != address(0), "Vault: zero usdc");
        require(_collateralRatio > 0,          "Vault: zero ratio");

        syntheticToken  = SyntheticToken(_syntheticToken);
        oracleReader    = OracleReader(_oracleReader);
        usdc            = IERC20(_usdc);
        collateralRatio = _collateralRatio;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mint
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC and receive synthetic tokens at the oracle price.
     * @param usdcAmount Amount of USDC (6 decimals) to deposit.
     *
     * The full usdcAmount is pulled into the vault. A MINT_FEE_BPS fraction
     * is withheld as surplus collateral; only the remaining usdcForSynths
     * is used to compute the synth quantity.
     *
     * syntheticAmount = (usdcForSynths * 1e12 * 1e18 * 1e18) / (oraclePrice * collateralRatio)
     *
     * Example (150% ratio, price = $84, 0.5% fee, deposit $1.50 USDC):
     *   fee          = $0.0075  ← stays as excess collateral
     *   usdcForSynths= $1.4925
     *   synths       ≈ $1.4925 / ($84 × 1.5) ≈ 0.011845 sASSET
     *   vault holds  = $1.50  →  ratio ≈ 150.75%  ✓
     */
    function mint(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "Vault: zero amount");

        uint256 oraclePrice = oracleReader.getLatestPrice();

        // Fee stays in vault as surplus; only the net amount backs synths.
        uint256 feeUsdc       = (usdcAmount * MINT_FEE_BPS) / 10_000;
        uint256 usdcForSynths = usdcAmount - feeUsdc;

        uint256 syntheticAmount = (usdcForSynths * 1e12 * 1e18 * 1e18) / (oraclePrice * collateralRatio);
        require(syntheticAmount > 0, "Vault: synthetic amount too small");

        // Pull the full deposit — fee + collateral both remain in the vault.
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        accumulatedFees += feeUsdc;

        syntheticToken.mint(msg.sender, syntheticAmount);

        _checkInvariant(oraclePrice);

        emit FeeCollected(msg.sender, feeUsdc);
        emit Minted(msg.sender, usdcAmount, syntheticAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Redeem
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Burn synthetic tokens and receive USDC at the oracle price.
     * @param syntheticAmount Amount of synthetic tokens (18 decimals) to redeem.
     *
     * usdcOut = (syntheticAmount * oraclePrice / 1e18) / 1e12
     *
     * Arbitrageurs can exploit oracle-AMM price gaps:
     *   1. AMM price < oracle price  →  buy synths cheap from AMM pool
     *   2. Redeem here at the higher oracle price for a USDC profit
     * The accumulated mint-fee buffer ensures the vault always has sufficient
     * USDC to honour these redemptions even under price stress.
     */
    function redeem(uint256 syntheticAmount) external nonReentrant {
        require(syntheticAmount > 0, "Vault: zero amount");
        require(
            syntheticToken.balanceOf(msg.sender) >= syntheticAmount,
            "Vault: insufficient synth balance"
        );

        uint256 oraclePrice = oracleReader.getLatestPrice();

        // Value in 18-decimal USD, then convert to 6-decimal USDC
        uint256 usdcAmount18 = (syntheticAmount * oraclePrice) / 1e18;
        uint256 usdcAmount   = usdcAmount18 / 1e12;
        require(usdcAmount > 0, "Vault: USDC amount too small");

        require(
            usdc.balanceOf(address(this)) >= usdcAmount,
            "Vault: insufficient liquidity"
        );

        // Burn synthetic from caller first, then transfer USDC
        syntheticToken.burn(msg.sender, syntheticAmount);
        usdc.safeTransfer(msg.sender, usdcAmount);

        _checkInvariant(oraclePrice);

        emit Redeemed(msg.sender, syntheticAmount, usdcAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @return tvl USDC balance of the vault (6 decimals).
    function getTVL() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice USDC surplus above the minimum required collateral (6 decimals).
     * @dev    This is the capital buffer that keeps arb redemptions safe.
     *         When the AMM price falls below the oracle price, an arbitrageur
     *         buys synths cheaply from the pool and redeems them here at oracle
     *         price. The surplus from accumulated mint fees guarantees the vault
     *         can pay them out, closing the price gap and keeping the system
     *         healthy.
     */
    function getExcessCollateral() external view returns (uint256) {
        uint256 totalSupply  = syntheticToken.totalSupply();
        uint256 vaultBalance = usdc.balanceOf(address(this));

        if (totalSupply == 0) return vaultBalance;

        uint256 oraclePrice        = oracleReader.getLatestPrice();
        uint256 valueIn18          = (totalSupply * oraclePrice) / 1e18;
        uint256 requiredCollateral = (valueIn18 * collateralRatio) / 1e18;
        // Convert required collateral from 18-dec to 6-dec (ceiling division).
        uint256 required6dec = (requiredCollateral + 1e11) / 1e12;

        return vaultBalance > required6dec ? vaultBalance - required6dec : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Enforce: scaledVaultBalance >= requiredCollateral
     *
     * All arithmetic normalised to 18-decimal USD values:
     *
     *   valueIn18          = totalSupply * oraclePrice / 1e18
     *   requiredCollateral = valueIn18 * collateralRatio / 1e18
     *   scaledVaultBalance = vaultBalance(6 dec) * 1e12
     */
    function _checkInvariant(uint256 oraclePrice) internal view {
        uint256 totalSupply  = syntheticToken.totalSupply();
        uint256 vaultBalance = usdc.balanceOf(address(this));

        if (totalSupply == 0) return;

        uint256 valueIn18          = (totalSupply * oraclePrice) / 1e18;
        uint256 requiredCollateral = (valueIn18 * collateralRatio) / 1e18;
        uint256 scaledVaultBalance = vaultBalance * 1e12;

        require(
            scaledVaultBalance >= requiredCollateral,
            "Vault: invariant - undercollateralised"
        );
    }
}
