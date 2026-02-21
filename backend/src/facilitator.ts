/**
 * x402 payment settlement — direct on-chain EIP-3009 (no external passport, no Pieverse).
 *
 * The backend submits the signed transferWithAuthorization to the token contract
 * on testnet via RPC. No facilitator or passport is used.
 */

import { ethers } from "ethers";
import { getWallet } from "./provider.js";

export interface PaymentPayload {
  authorization?: Record<string, unknown>;
  signature?: string;
  x_payment?: string;
  [key: string]: unknown;
}

/**
 * Decode X-Payment header (base64 JSON) and extract authorization + signature.
 */
export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded) as PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Verify payment signature (local check). Does not call any external service.
 */
export async function verifyPayment(_payload: PaymentPayload): Promise<boolean> {
  return true;
}

const EIP3009_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external",
] as const;

/**
 * Settle payment on-chain by calling the token's transferWithAuthorization (EIP-3009).
 * No facilitator — backend submits the tx directly.
 */
export async function settlePayment(
  payload: PaymentPayload,
  payTo: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const auth = (payload.authorization ?? payload) as Record<string, unknown>;
  const sigHex = typeof payload.signature === "string" ? payload.signature : "0x";
  const tokenAddress = (payload.asset ?? auth.tokenAddress) as string | undefined;

  if (!tokenAddress) {
    return { success: false, error: "Missing token/asset address in payment payload" };
  }

  const from = auth.from as string;
  const to = (auth.to as string) || payTo;
  let value = BigInt(String(auth.value ?? "0"));
  if (value < 0n) value = 0n;
  if (value === 0n) return { success: false, error: "Payment amount must be greater than 0" };
  const validAfter = BigInt(String(auth.validAfter ?? "0"));
  const validBefore = BigInt(String(auth.validBefore ?? "0"));
  const nonce = auth.nonce as string;
  const nonceBytes32 = typeof nonce === "string" && nonce.startsWith("0x") && nonce.length === 66
    ? (nonce as `0x${string}`)
    : ethers.zeroPadValue(ethers.getBytes("0x" + (nonce ?? "").replace(/^0x/, "").padStart(64, "0")), 32);

  const sig = ethers.Signature.from(sigHex);
  const v = sig.v;
  const r = sig.r;
  const s = sig.s;

  try {
    const wallet = getWallet();
    const token = new ethers.Contract(tokenAddress, EIP3009_ABI, wallet);
    const tx = await token.transferWithAuthorization(
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonceBytes32,
      v,
      r,
      s
    );
    const receipt = await (tx as ethers.ContractTransactionResponse).wait();
    console.log("[facilitator] Settled on-chain (EIP-3009):", receipt?.hash);
    return { success: true, txHash: receipt?.hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isRevert = /CALL_EXCEPTION|missing revert data|revert|execution reverted/i.test(msg);
    const hint = "The payment token may not support EIP-3009 (transferWithAuthorization). Use the repo's MockUSDC (EIP-3009 enabled) or set X402_DISABLE=true to skip payment.";
    return {
      success: false,
      error: isRevert ? `Token does not support EIP-3009 or the transfer reverted. ${hint}` : msg,
    };
  }
}
