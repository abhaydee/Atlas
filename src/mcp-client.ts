import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface PayerAddress {
  payer_addr: string;
}

export interface PaymentApproval {
  x_payment: string;
  [key: string]: unknown;
}

export class KiteMCPClient {
  private client: Client | null = null;
  private connected = false;

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      log.debug("MCP client already connected");
      return;
    }

    const mcpUrl = config.kite.mcpUrl;
    log.info(`Connecting to Kite MCP server: ${mcpUrl}`);

    this.client = new Client({
      name: "kite-ai-trade-agent",
      version: "1.0.0",
    });

    // Try StreamableHTTP first, fall back to SSE
    try {
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
      await this.client.connect(transport);
      this.connected = true;
      log.success("Connected to Kite MCP via StreamableHTTP");
    } catch {
      log.debug("StreamableHTTP failed, trying SSE transport...");
      try {
        this.client = new Client({
          name: "kite-ai-trade-agent",
          version: "1.0.0",
        });
        const sseTransport = new SSEClientTransport(new URL(mcpUrl));
        await this.client.connect(sseTransport);
        this.connected = true;
        log.success("Connected to Kite MCP via SSE");
      } catch (err) {
        this.connected = false;
        throw new Error(
          `Failed to connect to Kite MCP server at ${mcpUrl}: ${err}`
        );
      }
    }

    const tools = await this.client.listTools();
    log.info(
      `Available MCP tools: ${tools.tools.map((t) => t.name).join(", ")}`
    );
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
      log.info("Disconnected from Kite MCP server");
    }
  }

  async getPayerAddress(): Promise<PayerAddress> {
    this.ensureConnected();
    log.debug("Calling get_payer_addr...");

    const result = await this.client!.callTool({
      name: "get_payer_addr",
      arguments: {},
    });

    const parsed = this.parseToolResult(result);
    const payerAddr = parsed as unknown as PayerAddress;
    log.success(`Payer address: ${payerAddr.payer_addr}`);
    return payerAddr;
  }

  async approvePayment(params: {
    payerAddr: string;
    payeeAddr: string;
    amount: string;
    tokenType: string;
    merchantName?: string;
  }): Promise<PaymentApproval> {
    this.ensureConnected();
    log.payment(
      `Approving payment: ${params.amount} ${params.tokenType} → ${params.payeeAddr}`
    );

    const result = await this.client!.callTool({
      name: "approve_payment",
      arguments: {
        payer_addr: params.payerAddr,
        payee_addr: params.payeeAddr,
        amount: params.amount,
        token_type: params.tokenType,
        ...(params.merchantName && { merchant_name: params.merchantName }),
      },
    });

    const parsed = this.parseToolResult(result);
    log.success("Payment approved");
    return parsed as PaymentApproval;
  }

  async listTools(): Promise<string[]> {
    this.ensureConnected();
    const result = await this.client!.listTools();
    return result.tools.map((t) => t.name);
  }

  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error(
        "MCP client not connected. Call connect() first."
      );
    }
  }

  private parseToolResult(result: unknown): Record<string, unknown> {
    const res = result as {
      content?: Array<{ type: string; text?: string }>;
    };
    if (res.content && res.content.length > 0 && res.content[0].text) {
      try {
        return JSON.parse(res.content[0].text);
      } catch {
        return { raw: res.content[0].text };
      }
    }
    return result as Record<string, unknown>;
  }
}
