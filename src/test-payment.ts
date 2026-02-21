/**
 * Standalone test script to verify the x402 payment flow.
 *
 * Usage:
 *   npm run test:payment
 *
 * This will:
 *   1. Probe the weather service for payment requirements
 *   2. Connect to Kite MCP
 *   3. Get the payer wallet address
 *   4. Approve a payment
 *   5. Call the service with the X-Payment header
 */

import { KiteMCPClient } from "./mcp-client.js";
import { X402Handler } from "./x402-handler.js";
import { log } from "./logger.js";
import "./config.js";

const WEATHER_URL = "https://x402.dev.gokite.ai/api/weather?location=San%20Francisco";

async function run() {
  console.log("\n=== Kite Agent Passport — x402 Payment Test ===\n");

  // Step 1: Probe the service
  log.info("Step 1: Probing weather service for payment requirements...");
  try {
    const probeRes = await fetch(WEATHER_URL);
    log.info(`  Status: ${probeRes.status} ${probeRes.statusText}`);
    if (probeRes.status === 402) {
      const body = (await probeRes.json()) as { accepts?: Array<{ merchantName: string; maxAmountRequired: string; payTo: string; network: string; asset: string }> };
      const req = body.accepts?.[0];
      if (req) {
        log.payment(`  Merchant: ${req.merchantName}`);
        log.payment(`  Amount:   ${req.maxAmountRequired} wei`);
        log.payment(`  Pay To:   ${req.payTo}`);
        log.payment(`  Network:  ${req.network}`);
        log.payment(`  Asset:    ${req.asset}`);
      }
    } else {
      log.info("  Service did not return 402. It may not require payment.");
    }
  } catch (err) {
    log.error(`  Probe failed: ${err}`);
  }

  // Step 2: Connect MCP
  log.info("\nStep 2: Connecting to Kite MCP server...");
  const mcpClient = new KiteMCPClient();
  try {
    await mcpClient.connect();
  } catch (err) {
    log.error(`  MCP connection failed: ${err}`);
    log.info("\n  Make sure you have:");
    log.info("    - A Kite Portal account with an Agent created");
    log.info("    - The correct KITE_MCP_URL in your .env");
    log.info("    - Completed OAuth authentication");
    process.exit(1);
  }

  // Step 3: Full payment flow
  log.info("\nStep 3: Executing full x402 payment flow...");
  const handler = new X402Handler(mcpClient);
  const result = await handler.callService(WEATHER_URL);

  console.log("\n=== Result ===");
  console.log(JSON.stringify(result, null, 2));

  await mcpClient.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  log.error(`Fatal: ${err}`);
  process.exit(1);
});
