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
 */
contract SyntheticVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    SyntheticToken public immutable syntheticToken;
    OracleReader   public immutable oracleReader;
    IERC20         public immutable usdc;

    /// @notice 1e18 == 100% collateralisation required.
    uint256 public collateralRatio;

    event Minted(address indexed user, uint256 usdcIn, uint256 synthOut);
    event Redeemed(address indexed user, uint256 synthIn, uint256 usdcOut);

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
     * syntheticAmount = (usdcAmount * 1e12 * 1e18) / oraclePrice
     *
     * Rationale:
     *   usdcAmount * 1e12  converts 6-decimal USDC → 18-decimal value
     *   × 1e18 / oraclePrice  divides by the per-token price (1e18-scaled)
     *   result is in 18-decimal synthetic tokens
     */
    function mint(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "Vault: zero amount");

        uint256 oraclePrice = oracleReader.getLatestPrice();

        uint256 syntheticAmount = (usdcAmount * 1e12 * 1e18) / oraclePrice;
        require(syntheticAmount > 0, "Vault: synthetic amount too small");

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Mint synthetic tokens to caller
        syntheticToken.mint(msg.sender, syntheticAmount);

        // Invariant check (always passes for 100% ratio, provides defence in depth)
        _checkInvariant(oraclePrice);

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
     * Rationale:
     *   syntheticAmount * oraclePrice / 1e18  → value in 18-decimal USD
     *   / 1e12                                → convert to 6-decimal USDC
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
        uint256 totalSupply       = syntheticToken.totalSupply();
        uint256 vaultBalance      = usdc.balanceOf(address(this));

        if (totalSupply == 0) return; // Nothing to back

        uint256 valueIn18          = (totalSupply * oraclePrice) / 1e18;
        uint256 requiredCollateral = (valueIn18 * collateralRatio) / 1e18;
        uint256 scaledVaultBalance = vaultBalance * 1e12;

        require(
            scaledVaultBalance >= requiredCollateral,
            "Vault: invariant - undercollateralised"
        );
    }
}
