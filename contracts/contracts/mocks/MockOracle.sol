// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockOracle
 * @notice AggregatorV3-compatible oracle for local/testnet development.
 *         Only the deployer (owner) can update the price.
 *         Default: $1000 with 8 decimals  →  1000_00000000
 */
contract MockOracle is Ownable {
    int256  private _price;
    uint8   private _decimals;
    uint256 private _updatedAt;
    uint80  private _roundId;

    event PriceUpdated(int256 oldPrice, int256 newPrice, uint256 timestamp);

    constructor(int256 initialPrice, uint8 decimals_, address initialOwner)
        Ownable(initialOwner)
    {
        require(initialPrice > 0, "MockOracle: price must be positive");
        _price     = initialPrice;
        _decimals  = decimals_;
        _updatedAt = block.timestamp;
        _roundId   = 1;
    }

    /// @notice Update the mock price. Only callable by owner (deployer).
    function setPrice(int256 newPrice) external onlyOwner {
        require(newPrice > 0, "MockOracle: price must be positive");
        emit PriceUpdated(_price, newPrice, block.timestamp);
        _price     = newPrice;
        _updatedAt = block.timestamp;
        _roundId++;
    }

    // ── AggregatorV3Interface ────────────────────────────────────────────────

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }
}
