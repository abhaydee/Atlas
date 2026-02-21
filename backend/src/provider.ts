/**
 * Shared provider + wallet singleton.
 *
 * Uses ethers staticNetwork (chain ID 2410) to skip the automatic
 * "detect network" RPC call that floods logs with retry messages
 * when the node is slow to respond.
 *
 * Import getProvider() / getWallet() from here instead of
 * constructing them inline in each module.
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const RPC_URL     = process.env.RPC_URL     || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const CHAIN_ID    = parseInt(process.env.CHAIN_ID || "2368", 10);

// ── Singleton provider ────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;

/**
 * Returns a shared JsonRpcProvider.
 * Uses staticNetwork so ethers does NOT fire an eth_chainId call on creation
 * — eliminating the "JsonRpcProvider failed to detect network" spam.
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!RPC_URL) throw new Error("RPC_URL is not set in backend/.env");
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(
      RPC_URL,
      CHAIN_ID,            // staticNetwork — skips auto-detection
      { staticNetwork: true }
    );
  }
  return _provider;
}

/** Returns null instead of throwing — safe for optional read-only calls. */
export function getProviderOrNull(): ethers.JsonRpcProvider | null {
  try { return getProvider(); } catch { return null; }
}

// ── Wallet ────────────────────────────────────────────────────────────────────

/** Validates the private key format before creating a wallet. */
function isValidPrivateKey(key: string): boolean {
  if (!key || key === "your_private_key_here") return false;
  const clean = key.startsWith("0x") ? key.slice(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(clean);
}

/**
 * Returns a wallet connected to the shared provider.
 * Throws a clear error if PRIVATE_KEY is missing or still a placeholder.
 */
export function getWallet(): ethers.Wallet {
  if (!isValidPrivateKey(PRIVATE_KEY)) {
    throw new Error(
      "PRIVATE_KEY is not configured.\n" +
      "  1. Open backend/.env\n" +
      "  2. Set PRIVATE_KEY=<your 64-hex-char private key>\n" +
      "  3. Fund the wallet with testnet USDT: https://faucet.gokite.ai/"
    );
  }
  const provider = getProvider();
  const key = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  return new ethers.Wallet(key, provider);
}

/** Returns null if the private key is not configured — safe for optional identity checks. */
export function getWalletOrNull(): ethers.Wallet | null {
  try { return getWallet(); } catch { return null; }
}
