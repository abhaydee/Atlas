/**
 * Atlas Research Agent — powered by OpenRouter.
 *
 * Simulates Stage 1 (Data Source Discovery) from the protocol spec:
 * researches and evaluates reliable data sources for a given asset class.
 */

import dotenv from "dotenv";
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL   = process.env.OPENROUTER_MODEL   || "mistralai/mistral-7b-instruct:free";
const OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions";

export interface DataSource {
  name: string;
  type: string;
  updateFrequency: string;
  reliability: string;
  pythFeedId?: string;  // Pyth Network price feed ID — preferred over url+jsonPath
  pythSymbol?: string;  // e.g. "XAU/USD" — informational
  url?: string;
  jsonPath?: string;    // e.g. "$.price" or "$.data.last" — fallback only
}

export interface ResearchResult {
  assetClass: string;
  dataSources: DataSource[];
  suggestedFeedName: string;
  volatilityEstimate: string;
  recommendedFee: string;
  summary: string;
}

const SYSTEM_PROMPT = `You are a DeFi oracle research agent working for a synthetic asset protocol.
Given an asset class, identify reliable real-world data sources for on-chain price feeds.
You must respond with a valid JSON object only — no markdown, no explanations.

PREFERRED DATA SOURCE — Pyth Network (always use when available):
Pyth Network is the gold standard for on-chain price feeds. Aggregates 20+ market makers, updates every ~400ms, no API key required.
Use the Hermes REST API: https://hermes.pyth.network/v2/updates/price/latest?ids[]=<feedId>&parsed=true

Known Pyth feed IDs (use these exactly):
- Gold (XAU/USD):     765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2
- Silver (XAG/USD):   f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e
- Bitcoin (BTC/USD):  e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
- Ethereum (ETH/USD): ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
- Solana (SOL/USD):   ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
- Apple (AAPL/USD):   49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688
- Tesla (TSLA/USD):   16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1
- Microsoft (MSFT):   d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1
- Nvidia (NVDA/USD):  b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593
- Crude Oil (WTI):    0058c6f03fd28b18083d00fcdc3baaed2f11edef8b981f6b74130b85be474b17
- EUR/USD:            a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b
- Chainlink (LINK):   8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221
- Avalanche (AVAX):   93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7
- Dogecoin (DOGE):    dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c
- Cardano (ADA/USD):  2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d
- Polkadot (DOT/USD): ca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b

For unknown assets, search: https://hermes.pyth.network/v2/price_feeds?query=<asset_name>

FALLBACK — only if asset is not on Pyth: use a free public JSON API with no auth.
NEVER use a gold proxy for silver. NEVER use one asset as a proxy for another.

Required JSON structure:
{
  "assetClass": "string",
  "dataSources": [
    {
      "name": "string",
      "type": "pyth | API | aggregator | exchange | index",
      "updateFrequency": "string (e.g. '400ms' for Pyth, '1 minute' for APIs)",
      "reliability": "high | medium | low",
      "pythFeedId": "string (REQUIRED if asset is on Pyth — 64-char hex feed ID)",
      "pythSymbol": "string (e.g. 'XAU/USD' — required when pythFeedId is set)",
      "url": "string (fallback URL — omit if pythFeedId is set)",
      "jsonPath": "string (fallback JSONPath — omit if pythFeedId is set)"
    }
  ],
  "suggestedFeedName": "string (e.g. XAG/USD)",
  "volatilityEstimate": "string (e.g. '2% daily')",
  "recommendedFee": "string (e.g. '0.5%')",
  "summary": "string (2-3 sentences, include the expected price range in USD)"
}`;

export async function researchAsset(
  assetName: string,
  assetDescription: string
): Promise<ResearchResult> {
  if (!OPENROUTER_API_KEY) {
    console.warn("[agent] OPENROUTER_API_KEY not set — returning mock research.");
    return mockResearch(assetName);
  }

  const userMessage = `Research data sources for: "${assetName}".
Description: ${assetDescription || "No additional description provided."}
Return reliable, manipulation-resistant data sources.`;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/kite-ai-trade-agent",
        "X-Title":      "Oracle Synthetic Protocol",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userMessage },
        ],
        temperature:     0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenRouter");

    // Strip markdown code blocks if present (```json ... ```)
    let raw = content.trim();
    const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) raw = codeBlock[1].trim();

    return JSON.parse(raw) as ResearchResult;
  } catch (err) {
    console.error("[agent] Research failed, using mock:", err);
    return mockResearch(assetName);
  }
}

/**
 * Maps an asset name to a Pyth Network price feed (primary) or a free public
 * API (fallback for assets not listed on Pyth).
 *
 * All pythFeedId values are live-tested against Hermes REST API.
 */
function pickFallbackSource(assetName: string): DataSource {
  const lower = assetName.toLowerCase();

  // ── Metals ────────────────────────────────────────────────────────────────
  if (lower.includes("gold") || lower.includes("xau")) {
    return {
      name: "Pyth Network — XAU/USD (Gold Spot)",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
      pythSymbol: "XAU/USD",
    };
  }

  if (lower.includes("silver") || lower.includes("xag")) {
    return {
      name: "Pyth Network — XAG/USD (Silver Spot)",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e",
      pythSymbol: "XAG/USD",
    };
  }

  // ── Crypto ────────────────────────────────────────────────────────────────
  if (lower.includes("bitcoin") || lower.includes("btc")) {
    return {
      name: "Pyth Network — BTC/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      pythSymbol: "BTC/USD",
    };
  }

  if (lower.includes("ethereum") || lower.includes("eth")) {
    return {
      name: "Pyth Network — ETH/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
      pythSymbol: "ETH/USD",
    };
  }

  if (lower.includes("solana") || lower.includes("sol")) {
    return {
      name: "Pyth Network — SOL/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
      pythSymbol: "SOL/USD",
    };
  }

  if (lower.includes("chainlink") || lower.includes("link")) {
    return {
      name: "Pyth Network — LINK/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
      pythSymbol: "LINK/USD",
    };
  }

  if (lower.includes("avalanche") || lower.includes("avax")) {
    return {
      name: "Pyth Network — AVAX/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7",
      pythSymbol: "AVAX/USD",
    };
  }

  if (lower.includes("dogecoin") || lower.includes("doge")) {
    return {
      name: "Pyth Network — DOGE/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
      pythSymbol: "DOGE/USD",
    };
  }

  if (lower.includes("cardano") || lower.includes("ada")) {
    return {
      name: "Pyth Network — ADA/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d",
      pythSymbol: "ADA/USD",
    };
  }

  if (lower.includes("polkadot") || lower.includes("dot")) {
    return {
      name: "Pyth Network — DOT/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "ca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b",
      pythSymbol: "DOT/USD",
    };
  }

  // ── US Equities ───────────────────────────────────────────────────────────
  if (lower.includes("apple") || lower.includes("aapl")) {
    return {
      name: "Pyth Network — AAPL/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
      pythSymbol: "AAPL/USD",
    };
  }

  if (lower.includes("tesla") || lower.includes("tsla")) {
    return {
      name: "Pyth Network — TSLA/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
      pythSymbol: "TSLA/USD",
    };
  }

  if (lower.includes("microsoft") || lower.includes("msft")) {
    return {
      name: "Pyth Network — MSFT/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
      pythSymbol: "MSFT/USD",
    };
  }

  if (lower.includes("nvidia") || lower.includes("nvda")) {
    return {
      name: "Pyth Network — NVDA/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
      pythSymbol: "NVDA/USD",
    };
  }

  // ── Commodities ───────────────────────────────────────────────────────────
  if (lower.includes("oil") || lower.includes("crude") || lower.includes("wti") || lower.includes("brent") || lower.includes("petroleum")) {
    return {
      name: "Pyth Network — WTI Crude Oil",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "0058c6f03fd28b18083d00fcdc3baaed2f11edef8b981f6b74130b85be474b17",
      pythSymbol: "WTI/USD",
    };
  }

  // ── FX ────────────────────────────────────────────────────────────────────
  if (lower.includes("euro") || lower.includes("eur")) {
    return {
      name: "Pyth Network — EUR/USD",
      type: "pyth",
      updateFrequency: "400ms",
      reliability: "high",
      pythFeedId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
      pythSymbol: "EUR/USD",
    };
  }

  // ── Generic fallback — will trigger dynamic Pyth search at runtime ─────────
  return {
    name: `Pyth Network — ${assetName.toUpperCase()} (dynamic feed lookup)`,
    type: "pyth",
    updateFrequency: "400ms",
    reliability: "medium",
    // No pythFeedId — oracle-runner will call getPythPrice() with dynamic search
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    jsonPath: "$.bitcoin.usd",
  };
}

function mockResearch(assetName: string): ResearchResult {
  const source = pickFallbackSource(assetName);
  return {
    assetClass: assetName,
    dataSources: [source],
    suggestedFeedName: `${assetName.replace(/\s+/g, "").toUpperCase()}/USD`,
    volatilityEstimate: "2% daily",
    recommendedFee: "0.5%",
    summary: `Fallback research for ${assetName} (OPENROUTER_API_KEY not set). Using ${source.name} as price feed. Set OPENROUTER_API_KEY for AI-discovered sources.`,
  };
}
