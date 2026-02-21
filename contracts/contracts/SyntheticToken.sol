// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SyntheticToken
 * @notice ERC-20 representing price exposure to an oracle-anchored asset.
 *         Only the SyntheticVault (owner) can mint or burn.
 */
contract SyntheticToken is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) ERC20(name_, symbol_) Ownable(initialOwner) {}

    /// @notice Mint tokens. Only callable by vault (owner).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn tokens. Only callable by vault (owner).
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
