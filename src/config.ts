import dotenv from "dotenv";
dotenv.config();

export const config = {
  kite: {
    mcpUrl: process.env.KITE_MCP_URL || "https://neo.dev.gokite.ai/v1/mcp",
    agentId: process.env.KITE_AGENT_ID || "",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    // Default to a free/cheap model — change to any OpenRouter model slug
    model: process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  agent: {
    maxAutoApproveAmount: parseFloat(
      process.env.MAX_AUTO_APPROVE_AMOUNT || "5"
    ),
    requirePaymentConfirmation:
      process.env.REQUIRE_PAYMENT_CONFIRMATION !== "false",
  },
  logLevel: (process.env.LOG_LEVEL || "info") as
    | "debug"
    | "info"
    | "warn"
    | "error",
} as const;

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.openrouter.apiKey) {
    errors.push(
      "OPENROUTER_API_KEY is required for autonomous agent reasoning — get one free at https://openrouter.ai"
    );
  }
  return errors;
}
