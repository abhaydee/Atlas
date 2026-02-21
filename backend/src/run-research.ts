#!/usr/bin/env npx tsx
/**
 * Run the research agent standalone to see how it performs.
 *
 * Usage:
 *   npx tsx src/run-research.ts
 *   npx tsx src/run-research.ts "Motorcycle Price Index" "US used motorcycle market"
 *   npx tsx src/run-research.ts "Gold" "Spot gold price USD"
 */

import { researchAsset } from "./agent.js";

const assetName = process.argv[2] || "Motorcycle Price Index";
const assetDescription = process.argv[3] || "Tracks the average price of used motorcycles in the US market.";

async function main() {
  console.log("─".repeat(60));
  console.log("Research Agent — Data Source Discovery");
  console.log("─".repeat(60));
  console.log(`Asset:       ${assetName}`);
  console.log(`Description: ${assetDescription}`);
  console.log();

  const start = Date.now();
  const research = await researchAsset(assetName, assetDescription);
  const elapsed = Date.now() - start;

  console.log("Result:");
  console.log(JSON.stringify(research, null, 2));
  console.log();
  console.log(`Completed in ${elapsed}ms`);
  console.log();

  // Validate: try to fetch from first data source
  const source = research.dataSources?.find((s) => s.url && s.jsonPath);
  if (source) {
    console.log("─".repeat(60));
    console.log("Validating first data source:", source.name);
    try {
      const res = await fetch(source.url!);
      const json = (await res.json()) as unknown;
      const pathParts = source.jsonPath!.replace(/^\$\./, "").split(".");
      let val: unknown = json;
      for (const k of pathParts) {
        val = (val as Record<string, unknown>)?.[k];
      }
      console.log("  Fetched price:", val, typeof val);
      if (typeof val === "number" || (typeof val === "string" && !isNaN(parseFloat(val)))) {
        console.log("  ✅ Valid — oracle runner can use this");
      } else {
        console.log("  ⚠️  Unexpected format — jsonPath may need adjustment");
      }
    } catch (err) {
      console.log("  ❌ Fetch failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("No data source with url+jsonPath found — oracle runner cannot update.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
