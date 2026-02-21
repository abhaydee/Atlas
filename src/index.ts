import chalk from "chalk";
import readline from "readline";
import { config, validateConfig } from "./config.js";
import { KiteMCPClient } from "./mcp-client.js";
import { TradeAgent } from "./trade-agent.js";
import { log } from "./logger.js";

const BANNER = `
${chalk.cyan("╔══════════════════════════════════════════════╗")}
${chalk.cyan("║")}  ${chalk.bold.white("Kite AI Trade Agent")}                        ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.gray("Autonomous x402 transactions on Kite L1")}     ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.yellow("Network: Kite Testnet")}                       ${chalk.cyan("║")}
${chalk.cyan("╚══════════════════════════════════════════════╝")}
`;

const HELP = `
${chalk.bold("Commands:")}
  ${chalk.green("trade <location>")}    Execute a weather trade (x402 payment)
  ${chalk.green("pool status")}         Show AMM pool state
  ${chalk.green("pool swap <A|B> <n>")} Swap N tokens through the pool (x402)
  ${chalk.green("probe <url>")}         Check service payment requirements
  ${chalk.green("wallet")}              Show wallet address & session stats
  ${chalk.green("history")}             Show trade history
  ${chalk.green("services")}            List known x402 services
  ${chalk.green("help")}                Show this help message
  ${chalk.green("quit")}                Exit the agent

  ${chalk.gray("Pool server:")} npm run pool:server   ${chalk.gray("(in a separate terminal)")}
  ${chalk.gray("Auto rebalancer:")} npm run pool:agent

  Or type any natural language request and the AI will decide what to do.
`;

async function main() {
  console.log(BANNER);

  // Validate configuration
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    log.warn("Configuration warnings:");
    configErrors.forEach((e) => log.warn(`  - ${e}`));
    log.info(
      'The agent can still run in manual mode. Copy .env.example to .env and fill in your keys.'
    );
    console.log();
  }

  log.info(`MCP Server: ${config.kite.mcpUrl}`);

  // Initialize MCP client
  const mcpClient = new KiteMCPClient();

  try {
    await mcpClient.connect();
  } catch (err) {
    log.error(`Failed to connect to Kite MCP server: ${err}`);
    log.info("");
    log.info("Troubleshooting:");
    log.info("  1. Make sure you have a Kite Portal account (invitation required)");
    log.info("  2. Create an Agent in the Kite Portal");
    log.info("  3. Check your KITE_MCP_URL in .env");
    log.info("  4. The MCP server may require OAuth — see README for details");
    log.info("");
    log.info("Starting in offline mode (you can still explore commands)...");
  }

  // Initialize trade agent
  const agent = new TradeAgent(mcpClient);

  try {
    if (mcpClient.isConnected) {
      await agent.initialize();
    }
  } catch (err) {
    log.warn(`Agent initialization partial: ${err}`);
  }

  // Check for --auto flag (single command mode)
  const autoCommand = process.argv.slice(2).find((arg) => arg !== "--auto");
  const isAutoMode = process.argv.includes("--auto");

  if (isAutoMode && autoCommand) {
    log.agent(`Auto mode: executing "${autoCommand}"`);
    const result = await agent.processCommand(autoCommand);
    console.log("\n" + result);
    await mcpClient.disconnect();
    return;
  }

  // Interactive REPL
  console.log(HELP);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("\nkite-agent> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      const result = await handleInput(input, agent, mcpClient, rl);
      if (result === "EXIT") return;
      if (result) {
        console.log("\n" + result);
      }
    } catch (err) {
      log.error(`${err}`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    log.info("Shutting down...");
    await mcpClient.disconnect();
    process.exit(0);
  });
}

async function handleInput(
  input: string,
  agent: TradeAgent,
  mcpClient: KiteMCPClient,
  rl: readline.Interface
): Promise<string | "EXIT" | null> {
  const lower = input.toLowerCase();
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "quit":
    case "exit":
      log.info("Shutting down...");
      await mcpClient.disconnect();
      rl.close();
      return "EXIT";

    case "help":
      return HELP;

    case "wallet":
    case "balance":
      return agent.processCommand("check my wallet balance");

    case "history":
      return agent.processCommand("show trade history");

    case "services": {
      const poolPort = process.env.POOL_SERVER_PORT || "8402";
      return [
        chalk.bold("\nKnown x402 Services:"),
        "",
        `  ${chalk.green("Weather API")}`,
        `  URL: https://x402.dev.gokite.ai/api/weather`,
        `  Params: ?location=CityName`,
        `  Cost: 1 USDT (testnet)`,
        "",
        `  ${chalk.green("Kite AMM Pool")}  ${chalk.gray("(start with: npm run pool:server)")}`,
        `  URL: http://localhost:${poolPort}/pool/swap`,
        `  Tokens: KITE / USDT`,
        `  Swap cost: 0.01 USDT (testnet)`,
        `  Add liquidity: 0.01 USDT (testnet)`,
        "",
        chalk.gray(
          "  Use 'probe <url>' to check any service's payment requirements"
        ),
      ].join("\n");
    }

    case "probe": {
      const url =
        parts[1] || "https://x402.dev.gokite.ai/api/weather";
      return agent.processCommand(`probe service at ${url}`);
    }

    case "trade": {
      const location = parts.slice(1).join(" ") || "San Francisco";
      return agent.processCommand(
        `execute a weather trade for ${location}`
      );
    }

    case "pool": {
      const sub = parts[1]?.toLowerCase();
      if (!sub || sub === "status" || sub === "price") {
        // Direct call — no AI needed for a free read
        return agent.processCommand("check pool status and price directly");
      }
      if (sub === "swap") {
        const tokenIn = (parts[2]?.toUpperCase() === "B" ? "B" : "A") as "A" | "B";
        const amountIn = parseFloat(parts[3] ?? "50") || 50;
        return agent.processCommand(`execute pool swap: sell ${amountIn} token${tokenIn === "A" ? " A (KITE) for USDT" : " B (USDT) for KITE"}`);
      }
      return agent.processCommand(`pool operation: ${parts.slice(1).join(" ")}`);
    }

    default:
      return agent.processCommand(input);
  }
}

main().catch((err) => {
  log.error(`Fatal: ${err}`);
  process.exit(1);
});
