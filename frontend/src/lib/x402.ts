/**
 * Native x402 payment client — no Kite Agent Passport required.
 *
 * Uses EIP-3009 (transferWithAuthorization) signed with the user's browser wallet.
 * The signed payload is base64-encoded and sent as the X-Payment header.
 * The backend then calls the Pieverse facilitator to settle on Kite.
 *
 * Flow:
 *   1. Backend returns 402 with payment details
 *   2. Frontend builds EIP-3009 authorization struct
 *   3. User signs with MetaMask (eth_signTypedData_v4)
 *   4. Frontend encodes { authorization, signature } as base64
 *   5. Frontend retries request with X-Payment header
 *   6. Backend calls Pieverse /settle → on-chain transfer
 */

import { ethers } from "ethers";

// ── EIP-3009 typed data ───────────────────────────────────────────────────────

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
};

// Kite testnet chain ID
const KITE_TESTNET_CHAIN_ID = 2368;

const TOKEN_ABI = [
  "function name()     view returns (string)",
  "function decimals() view returns (uint8)",
  "function version()  view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  // EIP-3009 support check
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentRequirement {
  scheme:             string;
  network:            string;
  maxAmountRequired:  string;   // in token's smallest unit (wei-like)
  resource:           string;
  description:        string;
  payTo:              string;
  asset:              string;   // token contract address
  merchantName:       string;
  maxTimeoutSeconds:  number;
  mimeType?:          string;
  extra?:             unknown;
}

export interface X402Required {
  error:        string;
  accepts:      PaymentRequirement[];
  x402Version:  number;
}

export interface TokenInfo {
  name:          string;
  decimals:      number;
  version:       string;
  balance:       bigint;
  supportsEIP3009: boolean;
}

// ── Token info ────────────────────────────────────────────────────────────────

export async function getTokenInfo(
  tokenAddress: string,
  userAddress:  string,
  provider:     ethers.Provider
): Promise<TokenInfo> {
  const contract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);

  const [name, decimals, balance] = await Promise.all([
    contract.name()                    as Promise<string>,
    contract.decimals()                as Promise<bigint>,
    contract.balanceOf(userAddress)    as Promise<bigint>,
  ]);

  // version() — USDC uses "2"; safe default is "2"
  let version = "2";
  try { version = await contract.version() as string; } catch { /* default */ }

  // EIP-3009 support: check if authorizationState exists
  let supportsEIP3009 = false;
  try {
    await contract.authorizationState(userAddress, ethers.ZeroHash);
    supportsEIP3009 = true;
  } catch { /* not supported */ }

  return { name, decimals: Number(decimals), version, balance, supportsEIP3009 };
}

// ── Build + sign payment header ───────────────────────────────────────────────

/**
 * Build an EIP-3009 transferWithAuthorization, sign it with the user's wallet,
 * and return the base64-encoded X-Payment header value.
 */
export async function buildXPaymentHeader(
  signer:  ethers.JsonRpcSigner,
  req:     PaymentRequirement
): Promise<string> {
  const provider  = signer.provider!;
  const network   = await provider.getNetwork();
  const chainId   = Number(network.chainId);
  const from      = await signer.getAddress();

  // Guard: warn if not on Kite testnet
  if (chainId !== KITE_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network. Please switch MetaMask to Kite Testnet (chain ID ${KITE_TESTNET_CHAIN_ID}).\n` +
      `Currently connected to chain ID ${chainId}.`
    );
  }

  const tokenInfo = await getTokenInfo(req.asset, from, provider);

  // Guard: check EIP-3009 support
  if (!tokenInfo.supportsEIP3009) {
    throw new Error(
      `${tokenInfo.name} does not support EIP-3009 (transferWithAuthorization).\n` +
      `Native x402 payments require EIP-3009. Use X402_DISABLE=true for testing.`
    );
  }

  // Guard: check balance
  const amount = BigInt(req.maxAmountRequired);
  if (tokenInfo.balance < amount) {
    const humanAmount = ethers.formatUnits(amount,            tokenInfo.decimals);
    const humanBal    = ethers.formatUnits(tokenInfo.balance, tokenInfo.decimals);
    throw new Error(
      `Insufficient ${tokenInfo.name} balance.\n` +
      `Required: ${parseFloat(humanAmount).toFixed(4)}  |  Have: ${parseFloat(humanBal).toFixed(4)}\n` +
      `Get testnet tokens at https://faucet.gokite.ai/`
    );
  }

  // EIP-712 domain for the token
  const domain = {
    name:              tokenInfo.name,
    version:           tokenInfo.version,
    chainId,
    verifyingContract: req.asset,
  };

  // Authorization
  const validAfter  = BigInt(0);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds);
  const nonce       = ethers.hexlify(ethers.randomBytes(32));

  const authValue = {
    from,
    to:          req.payTo,
    value:       amount,
    validAfter,
    validBefore,
    nonce,
  };

  // Sign
  const signature = await signer.signTypedData(domain, EIP3009_TYPES, authValue);

  // Build the payload that Pieverse /settle expects
  const payload = {
    authorization: {
      from:        authValue.from,
      to:          authValue.to,
      value:       amount.toString(),
      validAfter:  validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      // EIP-712 domain info — facilitator needs these to reconstruct the hash
      chainId:          chainId.toString(),
      tokenAddress:     req.asset,
      tokenName:        tokenInfo.name,
      tokenVersion:     tokenInfo.version,
    },
    signature,
    // x402 envelope fields
    network:  req.network,
    payTo:    req.payTo,
    asset:    req.asset,
  };

  return btoa(JSON.stringify(payload));
}

// ── Human-readable amount ─────────────────────────────────────────────────────

/**
 * Format a wei-like amount using token decimals.
 * Falls back to 18 decimals if decimals is not known yet.
 */
export function formatPaymentAmount(
  amountWei: string,
  decimals = 18
): string {
  try {
    return parseFloat(ethers.formatUnits(BigInt(amountWei), decimals)).toFixed(2);
  } catch {
    return "?";
  }
}
