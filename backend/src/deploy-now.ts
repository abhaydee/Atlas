/**
 * Standalone deploy script — deploys all protocol contracts to testnet.
 * Usage: npx tsx src/deploy-now.ts [assetName] [assetSymbol]
 *
 * Defaults to Gold / sGOLD for a quick first deployment.
 */
import dotenv from "dotenv";
dotenv.config();

import { deployProtocol } from "./deployer.js";

const assetName   = process.argv[2] || "Gold";
const assetSymbol = process.argv[3] || "sGOLD";

console.log("═══════════════════════════════════════════════");
console.log("  Atlas — Contract Deployment");
console.log(`  Asset: ${assetName} (${assetSymbol})`);
console.log("═══════════════════════════════════════════════");

deployProtocol(assetName, assetSymbol)
  .then(({ contracts }) => {
    console.log("\n✅  Deployment complete!\n");
    console.log("Contract addresses:");
    console.log("  OracleAggregator :", contracts.oracleAggregator);
    console.log("  OracleReader     :", contracts.oracleReader);
    console.log("  SyntheticToken   :", contracts.syntheticToken);
    console.log("  SyntheticVault   :", contracts.syntheticVault);
    console.log("  SynthPool        :", contracts.synthPool);
    console.log("\nAddresses saved to backend/deployed.json");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌  Deployment failed:", err.message || err);
    process.exit(1);
  });
