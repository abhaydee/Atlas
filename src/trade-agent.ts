import OpenAI from "openai";
import { KiteMCPClient } from "./mcp-client.js";
import { X402Handler, ServiceCallResult } from "./x402-handler.js";
import { config } from "./config.js";
import { log } from "./logger.js";

interface TradeAction {
  type: "call_service" | "check_balance" | "probe_service" | "pool_swap" | "pool_status" | "create_market" | "report";
  url?: string;
  params?: Record<string, string>;
  tokenIn?: "A" | "B";
  amountIn?: number;
  assetName?: string;
  assetSymbol?: string;
  totalPayment?: number;
  reason: string;
}

interface AgentState {
  walletAddress: string | null;
  lastTradeResult: ServiceCallResult | null;
  tradeHistory: Array<{
    timestamp: string;
    service: string;
    result: ServiceCallResult;
  }>;
  totalSpent: number;
}

const POOL_URL    = `http://localhost:${process.env.POOL_SERVER_PORT || "8402"}`;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

const KNOWN_SERVICES = [
  {
    name: "Weather Service",
    url: "https://x402.dev.gokite.ai/api/weather",
    description:
      "x402-protected weather API. Provides weather data for any location. Query param: ?location=CityName",
    exampleQuery: "?location=San%20Francisco",
  },
  {
    name: "Kite AMM Pool — Swap",
    url: `${POOL_URL}/pool/swap`,
    description:
      "x402-protected AMM swap. POST with { tokenIn: 'A'|'B', amountIn: number }. Swaps KITE/USDT.",
    exampleQuery: "",
  },
  {
    name: "Kite AMM Pool — Add Liquidity",
    url: `${POOL_URL}/pool/add-liquidity`,
    description:
      "x402-protected liquidity provision. POST with { amountA: number, amountB: number }.",
    exampleQuery: "",
  },
  {
    name: "Oracle Synthetic Protocol — Create Market",
    url: `${BACKEND_URL}/create-market`,
    description:
      "x402-protected. Create a synthetic asset market. POST with { assetName, assetSymbol?, assetDescription?, totalPayment? }. Pays in testnet USDT.",
    exampleQuery: "",
  },
];

const SYSTEM_PROMPT = `You are an autonomous AI trade agent operating on the Kite L1 Testnet via Kite Agent Passport.
Your capabilities:
- Call x402-protected services by paying with testnet stablecoins
- Check your wallet address
- Probe services to discover payment requirements
- Execute trades (service calls that require payment)

Available x402 services:
${KNOWN_SERVICES.map((s) => `- ${s.name}: ${s.url}\n  ${s.description}\n  Example: ${s.url}${s.exampleQuery}`).join("\n")}

Rules:
1. Always probe a service before calling it to understand costs
2. Report payment details clearly
3. When the user asks for a "trade", "swap", or "transaction", call the appropriate x402 service
4. Be transparent about costs and what you're doing
5. For weather queries, add the location as a query parameter: ?location=CityName
6. For pool swaps: the URL is ${POOL_URL}/pool/swap (POST with body)
7. For pool status: use the "report" type and fetch pool/status yourself

Respond with a JSON object describing the action to take:
{
  "type": "call_service" | "check_balance" | "probe_service" | "pool_swap" | "pool_status" | "create_market" | "report",
  "url": "full URL with query params if applicable",
  "tokenIn": "A" | "B",       // only for pool_swap
  "amountIn": <number>,       // only for pool_swap
  "assetName": "string",      // only for create_market
  "assetSymbol": "string",    // only for create_market (e.g. sMOTO)
  "totalPayment": <number>,   // only for create_market (USDT amount)
  "reason": "brief explanation"
}

If no action is needed (just reporting results), use type "report" with reason containing your message.`;

export class TradeAgent {
  private mcpClient: KiteMCPClient;
  private x402Handler: X402Handler;
  private openai: OpenAI;
  private state: AgentState;

  constructor(mcpClient: KiteMCPClient) {
    this.mcpClient = mcpClient;
    this.x402Handler = new X402Handler(mcpClient);
    this.openai = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/kite-ai-trade-agent",
        "X-Title": "Kite AI Trade Agent",
      },
    });
    this.state = {
      walletAddress: null,
      lastTradeResult: null,
      tradeHistory: [],
      totalSpent: 0,
    };
  }

  async initialize(): Promise<void> {
    log.agent("Initializing trade agent...");

    if (!this.mcpClient.isConnected) {
      await this.mcpClient.connect();
    }

    try {
      const payer = await this.mcpClient.getPayerAddress();
      this.state.walletAddress = payer.payer_addr;
      log.agent(`Wallet address: ${this.state.walletAddress}`);
    } catch (err) {
      log.warn(`Could not fetch wallet address at init: ${err}`);
    }

    log.agent("Trade agent ready");
  }

  async processCommand(userInput: string): Promise<string> {
    log.agent(`Processing: "${userInput}"`);

    // Fast-path pool commands without needing AI
    const lower = userInput.toLowerCase();
    if (lower.includes("pool") || lower.includes("amm") || lower.includes("liquidity") || lower.includes("swap")) {
      const fastAction = this.fastPoolRoute(lower);
      if (fastAction) {
        log.agent(`Fast-path: ${fastAction.type} — ${fastAction.reason}`);
        if (fastAction.type === "pool_status") return this.handlePoolStatus();
        if (fastAction.type === "pool_swap") return this.handlePoolSwap(fastAction.tokenIn!, fastAction.amountIn!);
      }
    }

    // Fast-path create market
    if (lower.includes("create market") || lower.includes("create synthetic") || lower.includes("deploy synthetic")) {
      const fastAction = this.fastCreateMarketRoute(lower, userInput);
      if (fastAction) {
        log.agent(`Fast-path: ${fastAction.type} — ${fastAction.reason}`);
        return this.handleCreateMarket(fastAction.assetName!, fastAction.assetSymbol, fastAction.totalPayment);
      }
    }

    const action = await this.decideAction(userInput);
    if (!action) {
      return "I couldn't determine what action to take. Please try rephrasing your request.";
    }

    log.agent(`Action: ${action.type} — ${action.reason}`);

    switch (action.type) {
      case "check_balance":
        return this.handleCheckBalance();
      case "probe_service":
        return this.handleProbeService(action.url!);
      case "call_service":
        return this.handleCallService(action.url!);
      case "pool_swap":
        return this.handlePoolSwap(action.tokenIn!, action.amountIn!);
      case "pool_status":
        return this.handlePoolStatus();
      case "create_market":
        return this.handleCreateMarket(action.assetName!, action.assetSymbol, action.totalPayment);
      case "report":
        return action.reason;
      default:
        return `Unknown action: ${action.type}`;
    }
  }

  /**
   * Execute a direct x402 service call (non-AI, for scripted use).
   */
  async executeServiceCall(url: string): Promise<ServiceCallResult> {
    return this.x402Handler.callService(url);
  }

  async probeService(url: string) {
    return this.x402Handler.probeService(url);
  }

  async getWalletAddress(): Promise<string | null> {
    if (!this.state.walletAddress) {
      try {
        const payer = await this.mcpClient.getPayerAddress();
        this.state.walletAddress = payer.payer_addr;
      } catch {
        return null;
      }
    }
    return this.state.walletAddress;
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }

  private async decideAction(userInput: string): Promise<TradeAction | null> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Current state:
- Wallet: ${this.state.walletAddress ?? "not fetched yet"}
- Total spent: ${this.state.totalSpent} wei
- Trade history: ${this.state.tradeHistory.length} trades
- Last result: ${this.state.lastTradeResult ? JSON.stringify(this.state.lastTradeResult).slice(0, 200) : "none"}

User request: ${userInput}`,
      },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: config.openrouter.model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      return JSON.parse(content) as TradeAction;
    } catch (err) {
      log.error(`AI decision failed: ${err}`);
      return this.fallbackDecision(userInput);
    }
  }

  private fastPoolRoute(lower: string): TradeAction | null {
    if (lower.includes("status") || lower.includes("price") || lower.includes("directly")) {
      return { type: "pool_status", reason: "Pool status check" };
    }
    if (lower.includes("swap") || lower.includes("sell") || lower.includes("buy")) {
      const isSellA = lower.includes("kite") || lower.includes(" a ") || lower.includes("token a") || lower.includes("sell a");
      const tokenIn = isSellA ? "A" : "B";
      const amountMatch = lower.match(/(\d+(\.\d+)?)/);
      const amountIn = amountMatch ? parseFloat(amountMatch[1]) : 50;
      return { type: "pool_swap", tokenIn, amountIn, reason: `Pool swap ${amountIn} ${tokenIn}` };
    }
    return null;
  }

  private fastCreateMarketRoute(lower: string, raw: string): TradeAction | null {
    const amountMatch = lower.match(/(\d+(\.\d+)?)\s*(usdt|usdc|testnet)?/i) || raw.match(/(\d+)/);
    const totalPayment = amountMatch ? parseFloat(amountMatch[1]) : 10;
    const assetMatch = raw.match(/(?:for|:)\s*["']?([^"',.]+)["']?/i) || raw.match(/(?:market|asset)\s+(?:for\s+)?(.+?)(?:\s+with|\s*$)/i);
    const assetName = assetMatch?.[1]?.trim() || "Synthetic Asset";
    const symbolMatch = assetName.match(/\b([A-Z]{2,6})\b/i);
    const assetSymbol = symbolMatch ? `s${symbolMatch[1].toUpperCase()}` : "sSYN";
    return {
      type:        "create_market",
      assetName,
      assetSymbol,
      totalPayment,
      reason:      `Create market for ${assetName}, pay ${totalPayment} USDT`,
    };
  }

  private fallbackDecision(input: string): TradeAction | null {
    const lower = input.toLowerCase();

    if (lower.includes("balance") || lower.includes("wallet") || lower.includes("address")) {
      return { type: "check_balance", reason: "User asked about wallet/balance" };
    }

    if (lower.includes("probe") || lower.includes("check") || lower.includes("cost")) {
      const service = KNOWN_SERVICES.find(
        (s) => lower.includes(s.name.toLowerCase()) || lower.includes("weather")
      );
      return {
        type: "probe_service",
        url: service?.url || KNOWN_SERVICES[0].url,
        reason: "Probing service cost",
      };
    }

    if (
      lower.includes("trade") ||
      lower.includes("buy") ||
      lower.includes("call") ||
      lower.includes("fetch") ||
      lower.includes("get weather") ||
      lower.includes("pay")
    ) {
      const locationMatch = lower.match(
        /(?:for|in|at|of)\s+([a-z\s]+?)(?:\s*$|\s*[,.])/i
      );
      const location = locationMatch?.[1]?.trim() || "San Francisco";
      const encodedLocation = encodeURIComponent(location);
      return {
        type: "call_service",
        url: `${KNOWN_SERVICES[0].url}?location=${encodedLocation}`,
        reason: `Execute weather trade for ${location}`,
      };
    }

    if (
      lower.includes("swap") ||
      lower.includes("pool") ||
      lower.includes("liquidity") ||
      lower.includes("amm")
    ) {
      if (lower.includes("status") || lower.includes("price") || lower.includes("check") || lower.includes("directly")) {
        return { type: "pool_status", reason: "Check pool state" };
      }
      const tokenInMatch = lower.match(/\bsell\s+(kite|a|token.?a)\b/) ||
        lower.match(/\bswap\s+(kite|a|token.?a)\b/);
      const tokenIn = tokenInMatch ? "A" : "B";
      const amountMatch = lower.match(/(\d+(\.\d+)?)/);
      const amountIn = amountMatch ? parseFloat(amountMatch[1]) : 50;
      return {
        type: "pool_swap",
        tokenIn,
        amountIn,
        reason: `Pool swap ${amountIn} ${tokenIn === "A" ? "KITE→USDT" : "USDT→KITE"}`,
      };
    }

    if (lower.includes("create market") || lower.includes("create synthetic") || lower.includes("deploy synthetic")) {
      return this.fastCreateMarketRoute(lower, input);
    }

    if (lower.includes("history") || lower.includes("status")) {
      const history = this.state.tradeHistory
        .map(
          (t) =>
            `[${t.timestamp}] ${t.service} — ${t.result.success ? "OK" : "FAIL"}`
        )
        .join("\n");
      return {
        type: "report",
        reason: history || "No trades executed yet.",
      };
    }

    return null;
  }

  private async handleCheckBalance(): Promise<string> {
    try {
      const payer = await this.mcpClient.getPayerAddress();
      this.state.walletAddress = payer.payer_addr;
      return [
        `Wallet Address: ${payer.payer_addr}`,
        `Total Spent (session): ${this.state.totalSpent} wei`,
        `Trades Executed: ${this.state.tradeHistory.length}`,
      ].join("\n");
    } catch (err) {
      return `Failed to fetch wallet info: ${err}`;
    }
  }

  private async handleProbeService(url: string): Promise<string> {
    const requirement = await this.x402Handler.probeService(url);
    if (!requirement) {
      return `Service at ${url} does not require x402 payment (or is unreachable).`;
    }
    return [
      `Service: ${requirement.merchantName}`,
      `Description: ${requirement.description}`,
      `Cost: ${requirement.maxAmountRequired} wei`,
      `Pay To: ${requirement.payTo}`,
      `Network: ${requirement.network}`,
      `Token Asset: ${requirement.asset}`,
      `Timeout: ${requirement.maxTimeoutSeconds}s`,
    ].join("\n");
  }

  private async handleCallService(url: string): Promise<string> {
    const result = await this.x402Handler.callService(url);

    this.state.lastTradeResult = result;
    this.state.tradeHistory.push({
      timestamp: new Date().toISOString(),
      service: url,
      result,
    });

    if (result.paymentMade && result.paymentDetails) {
      this.state.totalSpent += parseInt(result.paymentDetails.amount, 10) || 0;
    }

    if (result.success) {
      const lines = [
        `Trade executed successfully!`,
        result.paymentMade
          ? `Payment: ${result.paymentDetails!.amount} wei → ${result.paymentDetails!.merchant}`
          : `No payment was needed.`,
        ``,
        `Response:`,
        typeof result.data === "object"
          ? JSON.stringify(result.data, null, 2)
          : String(result.data),
      ];
      return lines.join("\n");
    }

    return `Trade failed: ${result.error}`;
  }

  private async handlePoolSwap(tokenIn: "A" | "B", amountIn: number): Promise<string> {
    // Preview first (free)
    try {
      const previewRes = await fetch(
        `${POOL_URL}/pool/preview-swap?tokenIn=${tokenIn}&amountIn=${amountIn}`
      );
      if (previewRes.ok) {
        const preview = await previewRes.json() as { amountOut: number; priceImpact: number; newPrice: number };
        log.info(
          `Preview: ${amountIn} → ~${preview.amountOut.toFixed(4)} | impact: ${(preview.priceImpact * 100).toFixed(2)}%`
        );
      }
    } catch { /* non-fatal */ }

    // Execute via x402 payment
    const result = await this.x402Handler.callService(`${POOL_URL}/pool/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenIn, amountIn }),
    });

    this.state.lastTradeResult = result;
    this.state.tradeHistory.push({
      timestamp: new Date().toISOString(),
      service: `pool/swap`,
      result,
    });

    if (result.paymentMade && result.paymentDetails) {
      this.state.totalSpent += parseInt(result.paymentDetails.amount, 10) || 0;
    }

    if (result.success) {
      const data = result.data as { amountOut?: number; newPrice?: number; priceImpact?: number };
      return [
        `Pool swap executed!`,
        `Swapped: ${amountIn} ${tokenIn === "A" ? "KITE" : "USDT"} → ${data.amountOut?.toFixed(4) ?? "?"} ${tokenIn === "A" ? "USDT" : "KITE"}`,
        `New price: ${data.newPrice?.toFixed(6) ?? "?"}`,
        `Price impact: ${((data.priceImpact ?? 0) * 100).toFixed(2)}%`,
        result.paymentMade
          ? `Service fee paid: ${result.paymentDetails!.amount} wei (Kite testnet USDT)`
          : "",
      ].filter(Boolean).join("\n");
    }
    return `Pool swap failed: ${result.error}`;
  }

  private async handleCreateMarket(
    assetName: string,
    assetSymbol?: string,
    totalPayment?: number
  ): Promise<string> {
    const body = {
      assetName:        assetName || "Synthetic Asset",
      assetSymbol:      assetSymbol || "sSYN",
      assetDescription: "",
      totalPayment:     totalPayment ?? 10,
    };

    const result = await this.x402Handler.callService(`${BACKEND_URL}/create-market`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    this.state.lastTradeResult = result;
    this.state.tradeHistory.push({
      timestamp: new Date().toISOString(),
      service:   "create-market",
      result,
    });

    if (result.paymentMade && result.paymentDetails) {
      this.state.totalSpent += parseInt(result.paymentDetails.amount, 10) || 0;
    }

    if (result.success && result.data) {
      const market = result.data as { market?: { contracts?: Record<string, string>; assetName?: string; assetSymbol?: string } };
      const m = market.market;
      const contracts = m?.contracts;
      return [
        `Market created successfully!`,
        ``,
        `Asset: ${m?.assetName ?? "?"} (${m?.assetSymbol ?? "?"})`,
        result.paymentMade
          ? `Payment: ${result.paymentDetails!.amount} wei → ${result.paymentDetails!.merchant}`
          : ``,
        ``,
        `Contract addresses:`,
        `  Vault:  ${contracts?.syntheticVault ?? "?"}`,
        `  Token:  ${contracts?.syntheticToken ?? "?"}`,
        `  Oracle: ${contracts?.oracleReader ?? "?"}`,
        ``,
        `Open the frontend (npm run protocol:frontend) to mint and redeem.`,
      ].filter(Boolean).join("\n");
    }

    return `Create market failed: ${result.error}`;
  }

  private async handlePoolStatus(): Promise<string> {
    try {
      const res = await fetch(`${POOL_URL}/pool/status`);
      if (!res.ok) return "Pool server returned an error. Is it running? (npm run pool:server)";
      const s = await res.json() as {
        tokenA: string; tokenB: string; reserveA: number; reserveB: number;
        price: number; totalLiquidity: number; swapCount: number;
        feeRate: number; volumeA: number; volumeB: number;
      };
      return [
        `╔── Kite AMM Pool Status ─────────────────`,
        `║  Pair    : ${s.tokenA} / ${s.tokenB}`,
        `║  Price   : ${s.price.toFixed(6)} ${s.tokenB} per ${s.tokenA}`,
        `║  Reserve A: ${s.reserveA.toFixed(4)} ${s.tokenA}`,
        `║  Reserve B: ${s.reserveB.toFixed(4)} ${s.tokenB}`,
        `║  Liquidity: ${s.totalLiquidity.toFixed(4)} LP`,
        `║  Swaps   : ${s.swapCount}`,
        `║  Fee     : ${(s.feeRate * 100).toFixed(1)}%`,
        `║  Vol A   : ${s.volumeA.toFixed(4)}  Vol B: ${s.volumeB.toFixed(4)}`,
        `╚─────────────────────────────────────────`,
      ].join("\n");
    } catch {
      return "Cannot reach pool server. Run: npm run pool:server";
    }
  }
}
