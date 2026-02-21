/**
 * Agent Wallet Signer — autonomous x402 payment execution.
 *
 * The agent holds its own private key (PRIVATE_KEY in .env) and signs
 * EIP-3009 transferWithAuthorization payloads without any manual wallet
 * interaction. This replaces browser-wallet MetaMask signing.
 *
 * Flow:
 *   1. Agent builds EIP-3009 authorization struct
 *   2. Agent signs with its own private key (ethers.Wallet.signTypedData)
 *   3. Payload is base64-encoded as X-Payment header
 *   4. Backend calls Pieverse facilitator to settle on Kite Testnet
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import { getWallet } from "./provider.js";
dotenv.config();

const KITE_CHAIN_ID = parseInt(process.env.CHAIN_ID || "2368", 10);

const EIP3009_TYPES: Record<string, ethers.TypedDataField[]> = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
};

const TOKEN_ABI = [
  "function name()     view returns (string)",
  "function decimals() view returns (uint8)",
  "function version()  view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

export interface AgentIdentity {

  address:   string;
  signature: string;
  message:   string;
  timestamp: string;
}

export interface PaymentLog {
  action:          string;
  amountRaw:       string;
  amountHuman:     string;
  tokenAddress:    string;
  payTo:           string;
  agentAddress:    string;
  txHash?:         string;
  status:          "pending" | "success" | "failed";
  error?:          string;
  timestamp:       string;
}

/** Create and return the agent's ethers.Wallet (uses shared provider). */
export function getAgentWallet(): ethers.Wallet {
  return getWallet(); // throws clearly if PRIVATE_KEY is missing/invalid
}

/**
 * Returns a verifiable agent identity.
 * Signing is purely local (no RPC call needed) — works even if RPC is slow.
 */
export async function getAgentIdentity(): Promise<AgentIdentity> {
  const wallet    = getWallet();
  // getAddress() is derived locally from private key — no network call
  const address   = wallet.address;
  const timestamp = new Date().toISOString();
  const message   = `Kite Autonomous Agent | ${address} | ${timestamp}`;
  const signature = await wallet.signMessage(message);
  return { address, signature, message, timestamp };
}

/**
 * Sign an EIP-3009 transferWithAuthorization using the agent's private key
 * and return a base64-encoded X-Payment header value ready for the facilitator.
 *
 * Throws if the agent wallet has insufficient token balance.
 */
export async function signAgentPayment(opts: {
  tokenAddress:    string;
  payTo:           string;
  amountRaw:       bigint;   // in token's smallest unit (e.g. USDT: 6 dec)
  timeoutSeconds?: number;
}): Promise<{ xPaymentHeader: string; log: Omit<PaymentLog, "txHash" | "status" | "error"> }> {
  const { tokenAddress, payTo, amountRaw, timeoutSeconds = 300 } = opts;

  const wallet   = getWallet();
  const from     = wallet.address;
  const provider = wallet.provider!;

  // ── Fetch token metadata ─────────────────────────────────────────────────
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);

  const [name, decimalsRaw, balanceRaw] = await Promise.all([
    token.name()           as Promise<string>,
    token.decimals()       as Promise<bigint>,
    token.balanceOf(from)  as Promise<bigint>,
  ]);

  const decimals = Number(decimalsRaw);

  // ── Balance guard ─────────────────────────────────────────────────────────
  if (balanceRaw < amountRaw) {
    const humanRequired = ethers.formatUnits(amountRaw,   decimals);
    const humanHave     = ethers.formatUnits(balanceRaw,  decimals);
    throw new Error(
      `Agent wallet insufficient funds.\n` +
      `  Required: ${parseFloat(humanRequired).toFixed(4)} ${name}\n` +
      `  Have:     ${parseFloat(humanHave).toFixed(4)} ${name}\n` +
      `  Wallet:   ${from}\n` +
      `  Fund it at: https://faucet.gokite.ai/`
    );
  }

  // ── Resolve token version (EIP-712 domain) ────────────────────────────────
  let version = "2";
  try { version = await token.version() as string; } catch { /* default "2" */ }

  // ── Build EIP-3009 authorization ─────────────────────────────────────────
  const validAfter  = BigInt(0);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + timeoutSeconds);
  const nonce       = ethers.hexlify(ethers.randomBytes(32));

  const domain = {
    name,
    version,
    chainId:           KITE_CHAIN_ID,
    verifyingContract: tokenAddress,
  };

  const authValue = {
    from,
    to:          payTo,
    value:       amountRaw,
    validAfter,
    validBefore,
    nonce,
  };

  // ── Sign with agent private key (no MetaMask, no popup) ──────────────────
  const signature = await wallet.signTypedData(domain, EIP3009_TYPES, authValue);

  // ── Build facilitator-compatible payload ──────────────────────────────────
  const payload = {
    authorization: {
      from,
      to:           payTo,
      value:        amountRaw.toString(),
      validAfter:   validAfter.toString(),
      validBefore:  validBefore.toString(),
      nonce,
      chainId:      KITE_CHAIN_ID.toString(),
      tokenAddress,
      tokenName:    name,
      tokenVersion: version,
    },
    signature,
    network: "kite-testnet",
    payTo,
    asset:   tokenAddress,
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");

  const log: Omit<PaymentLog, "txHash" | "status" | "error"> = {
    action:       "agent-x402-payment",
    amountRaw:    amountRaw.toString(),
    amountHuman:  `${parseFloat(ethers.formatUnits(amountRaw, decimals)).toFixed(4)} ${name}`,
    tokenAddress,
    payTo,
    agentAddress: from,
    timestamp:    new Date().toISOString(),
  };

  return { xPaymentHeader, log };
}
