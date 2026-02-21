// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice ERC20 with 6 decimals for local/testnet use. Owner can mint unlimited supply.
 *         Implements EIP-3009 transferWithAuthorization so x402 payment can settle on this token.
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;
    string private constant _VERSION = "2";

    // EIP-3009: https://eips.ethereum.org/EIPS/eip-3009
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    /// @dev authorizer => nonce => true if used
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor(address initialOwner)
        ERC20("Mock USDC", "USDC")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice EIP-712 domain version (USDC-style "2" for compatibility with agent signer).
    function version() external pure returns (string memory) {
        return _VERSION;
    }

    /// @notice Mint tokens to an account. Only callable by owner (deployer).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Execute a transfer with a signed EIP-3009 authorization (gasless approval).
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(!authorizationState[from][nonce], "EIP3009: authorization used");
        require(block.timestamp > validAfter, "EIP3009: not yet valid");
        require(block.timestamp < validBefore, "EIP3009: expired");

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        ));
        bytes32 domainSeparator = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(name())),
            keccak256(bytes(_VERSION)),
            block.chainid,
            address(this)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "EIP3009: invalid signature");

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }
}
