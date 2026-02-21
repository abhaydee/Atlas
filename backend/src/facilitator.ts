/**
 * Pieverse x402 Facilitator client.
 * Verifies and settles payments on Kite Testnet.
 *
 * @see https://facilitator.pieverse.io/
 * @see https://docs.gokite.ai/kite-agent-passport/service-provider-guide
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.pieverse.io";
const NETWORK = "kite-testnet";

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
 * Verify payment signature via facilitator. Does not execute on-chain.
 */
export async function verifyPayment(payload: PaymentPayload): Promise<boolean> {
  try {
    const res = await fetch(`${FACILITATOR_URL}/v2/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorization: payload.authorization ?? payload,
        signature: payload.signature ?? "",
        network: NETWORK,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Settle payment on-chain via facilitator. Transfers tokens to payee.
 *
 * Accepts two payload shapes:
 *   Shape A (browser wallet / Kite MCP): { authorization: {...}, signature: "0x..." }
 *   Shape B (legacy / raw):              flat authorization fields with top-level signature
 *
 * Tries Shape A first, falls back to Shape B if facilitator returns an error.
 */
export async function settlePayment(
  payload: PaymentPayload,
  payTo: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const sig = payload.signature ?? "";

  // ── Shape A: nested { authorization, signature } ──────────────────────────
  const shapeA: Record<string, unknown> = {
    network:       NETWORK,
    payTo,
    authorization: payload.authorization ?? payload,
    signature:     typeof sig === "string" ? sig : "0x",
  };

  // ── Shape B: flat payload (as some facilitator versions expect) ───────────
  const auth = payload.authorization ?? {};
  const shapeB: Record<string, unknown> = {
    network:       NETWORK,
    payTo,
    from:          (auth as Record<string, unknown>).from,
    to:            (auth as Record<string, unknown>).to ?? payTo,
    value:         (auth as Record<string, unknown>).value,
    validAfter:    (auth as Record<string, unknown>).validAfter,
    validBefore:   (auth as Record<string, unknown>).validBefore,
    nonce:         (auth as Record<string, unknown>).nonce,
    signature:     typeof sig === "string" ? sig : "0x",
  };

  console.log("[facilitator] Settling payment — Shape A:", JSON.stringify(shapeA).slice(0, 200));

  async function attemptSettle(body: Record<string, unknown>): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const res = await fetch(`${FACILITATOR_URL}/v2/settle`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = (await res.json()) as { success?: boolean; txHash?: string; error?: string; message?: string };
    if (res.ok && data.success) {
      return { success: true, txHash: data.txHash };
    }
    const errorMsg = data.error ?? data.message ?? res.statusText;
    return { success: false, error: `HTTP ${res.status}: ${errorMsg}` };
  }

  try {
    const resultA = await attemptSettle(shapeA);
    if (resultA.success) return resultA;

    // Shape A failed — try Shape B
    console.warn("[facilitator] Shape A failed:", resultA.error, "— retrying with Shape B");
    const resultB = await attemptSettle(shapeB);
    if (resultB.success) return resultB;

    // Both failed
    console.error("[facilitator] Both shapes failed. Shape A:", resultA.error, "| Shape B:", resultB.error);
    return { success: false, error: `Payment settlement failed. ${resultA.error ?? resultB.error}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
