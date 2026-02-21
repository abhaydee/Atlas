import { KiteMCPClient } from "./mcp-client.js";
import { log } from "./logger.js";

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  merchantName: string;
  outputSchema?: Record<string, unknown>;
  extra?: unknown;
}

export interface X402Response {
  error: string;
  accepts: X402PaymentRequirement[];
  x402Version: number;
}

export interface ServiceCallResult {
  success: boolean;
  data?: unknown;
  paymentMade: boolean;
  paymentDetails?: {
    amount: string;
    payee: string;
    merchant: string;
  };
  error?: string;
}

export class X402Handler {
  constructor(private mcpClient: KiteMCPClient) {}

  /**
   * Call an x402-protected service, handling the full payment flow automatically.
   * 1. Call the service
   * 2. If 402 → parse payment requirements
   * 3. Get payer address via MCP
   * 4. Approve payment via MCP
   * 5. Retry with X-Payment header
   */
  async callService(
    url: string,
    options: RequestInit = {}
  ): Promise<ServiceCallResult> {
    log.info(`Calling service: ${url}`);

    // Step 1: Initial request
    const initialResponse = await fetch(url, options);

    if (initialResponse.status !== 402) {
      // No payment required
      if (initialResponse.ok) {
        const data = await this.parseResponse(initialResponse);
        log.success("Service responded (no payment needed)");
        return { success: true, data, paymentMade: false };
      }
      return {
        success: false,
        paymentMade: false,
        error: `Service returned ${initialResponse.status}: ${initialResponse.statusText}`,
      };
    }

    // Step 2: Parse 402 payment requirements
    log.payment("Received 402 Payment Required");
    const paymentInfo = await this.parse402Response(initialResponse);

    if (!paymentInfo || paymentInfo.accepts.length === 0) {
      return {
        success: false,
        paymentMade: false,
        error: "No payment options available in 402 response",
      };
    }

    const requirement = paymentInfo.accepts[0];
    log.payment(
      `Payment required: ${requirement.maxAmountRequired} wei → ${requirement.payTo} (${requirement.merchantName})`
    );

    // Step 3: Get payer address
    const payer = await this.mcpClient.getPayerAddress();

    // Step 4: Approve payment
    const approval = await this.mcpClient.approvePayment({
      payerAddr: payer.payer_addr,
      payeeAddr: requirement.payTo,
      amount: requirement.maxAmountRequired,
      tokenType: "USDC",
      merchantName: requirement.merchantName,
    });

    // Step 5: Encode and retry
    const xPaymentValue = this.encodePaymentHeader(approval);

    log.debug("Retrying request with X-Payment header...");
    const paidResponse = await fetch(url, {
      ...options,
      headers: {
        ...Object.fromEntries(
          new Headers(options.headers as Record<string, string>).entries()
        ),
        "X-Payment": xPaymentValue,
      },
    });

    if (paidResponse.ok) {
      const data = await this.parseResponse(paidResponse);
      log.success("Service responded after payment");
      return {
        success: true,
        data,
        paymentMade: true,
        paymentDetails: {
          amount: requirement.maxAmountRequired,
          payee: requirement.payTo,
          merchant: requirement.merchantName,
        },
      };
    }

    return {
      success: false,
      paymentMade: true,
      paymentDetails: {
        amount: requirement.maxAmountRequired,
        payee: requirement.payTo,
        merchant: requirement.merchantName,
      },
      error: `Paid request failed with ${paidResponse.status}: ${await paidResponse.text()}`,
    };
  }

  /**
   * Probe a service to check if it requires x402 payment without executing.
   */
  async probeService(url: string): Promise<X402PaymentRequirement | null> {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status === 402) {
        const info = await this.parse402Response(response);
        return info?.accepts[0] ?? null;
      }
      return null;
    } catch (err) {
      log.error(`Failed to probe service at ${url}: ${err}`);
      return null;
    }
  }

  private async parse402Response(
    response: Response
  ): Promise<X402Response | null> {
    try {
      const body = await response.json();
      return body as X402Response;
    } catch (err) {
      log.error(`Failed to parse 402 response: ${err}`);
      return null;
    }
  }

  private encodePaymentHeader(approval: Record<string, unknown>): string {
    // The approval object needs to be Base64 encoded for the X-Payment header
    if (typeof approval.x_payment === "string") {
      // If it's already a string, it might already be encoded
      try {
        JSON.parse(atob(approval.x_payment));
        return approval.x_payment;
      } catch {
        // Not base64, encode the full object
      }
    }

    const jsonStr = JSON.stringify(approval);
    return btoa(jsonStr);
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }
}
