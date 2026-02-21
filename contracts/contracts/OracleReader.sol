// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Chainlink AggregatorV3-compatible interface.
 *         Switchboard EVM aggregators and MockOracle both implement this.
 */
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title OracleReader
 * @notice Reads price from a Switchboard/Chainlink-compatible feed and
 *         normalises to 1e18 scale. Reverts on zero price or stale data.
 */
contract OracleReader {
    IAggregatorV3 public immutable feed;
    uint256 public constant STALENESS_THRESHOLD = 2 hours;

    event FeedRead(uint256 price, uint256 updatedAt);

    constructor(address _feed) {
        require(_feed != address(0), "OracleReader: zero address");
        feed = IAggregatorV3(_feed);
    }

    /**
     * @return price Price scaled to 1e18 (18 decimals).
     */
    function getLatestPrice() external view returns (uint256 price) {
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();

        require(answer > 0, "OracleReader: non-positive price");
        require(
            block.timestamp - updatedAt <= STALENESS_THRESHOLD,
            "OracleReader: stale price"
        );

        uint8 dec = feed.decimals();
        if (dec <= 18) {
            price = uint256(answer) * (10 ** (18 - dec));
        } else {
            price = uint256(answer) / (10 ** (dec - 18));
        }
    }
}
