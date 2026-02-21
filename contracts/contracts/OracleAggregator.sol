// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OracleAggregator
 * @notice AggregatorV3-compatible oracle fed by our backend job runner.
 *         Fetches from agent-discovered URLs, parses, and posts here.
 *
 *         This replaces MockOracle with a real data pipeline.
 *         Switchboard is not deployed on Kite — we run our own job runner
 *         that mimics Switchboard's flow: URL fetch → parse → on-chain update.
 *
 *         Only the updater (owner or authorized address) can post prices.
 */
contract OracleAggregator is Ownable {
    int256  private _price;
    uint8   private _decimals;
    uint256 private _updatedAt;
    uint80  private _roundId;

    address public updater;

    event PriceUpdated(int256 oldPrice, int256 newPrice, uint256 timestamp);
    event UpdaterChanged(address indexed previousUpdater, address indexed newUpdater);

    constructor(int256 initialPrice, uint8 decimals_, address initialOwner)
        Ownable(initialOwner)
    {
        require(initialPrice > 0, "OracleAggregator: price must be positive");
        _price     = initialPrice;
        _decimals  = decimals_;
        _updatedAt = block.timestamp;
        _roundId   = 1;
        updater    = initialOwner;
    }

    modifier onlyUpdater() {
        require(msg.sender == updater || msg.sender == owner(), "OracleAggregator: not updater");
        _;
    }

    function setUpdater(address newUpdater) external onlyOwner {
        address old = updater;
        updater = newUpdater;
        emit UpdaterChanged(old, newUpdater);
    }

    /**
     * @notice Update price. Called by backend oracle job runner after fetching from data source.
     */
    function updatePrice(int256 newPrice) external onlyUpdater {
        require(newPrice > 0, "OracleAggregator: price must be positive");
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
