/**
 * Canonical list of assets we can pull from our data sources (Pyth).
 * Used for: GET /supported-assets, GET /validate-asset, and validating create-market.
 *
 * Standard format: displayName (user-facing), tokenSymbol (sXAG style), description (one line).
 */

import { PYTH_FEED_MAP, resolveFeedEntry, type PythFeedEntry } from "./pyth-provider.js";
import { getPythPrice } from "./pyth-provider.js";

export interface SupportedAsset {
  displayName: string;
  tokenSymbol: string;
  description: string;
  pythSymbol: string;
  assetType: string;
}

/** Build synthetic token symbol: s + base (e.g. XAG → sXAG, BTC → sBTC). */
function toTokenSymbol(pythSymbol: string): string {
  const base = pythSymbol.split("/")[0] ?? pythSymbol;
  return "s" + base;
}

/** Standard description by asset type. */
function standardDescription(displayName: string, pythSymbol: string, assetType: string): string {
  switch (assetType) {
    case "Metal":
      return `Spot ${displayName.toLowerCase()} price in USD per troy ounce (${pythSymbol}).`;
    case "Crypto":
      return `Spot ${displayName} price in USD (${pythSymbol}).`;
    case "Equity":
      return `Stock price in USD (${pythSymbol}).`;
    case "Commodities":
      return `Spot ${displayName.toLowerCase()} price in USD (${pythSymbol}).`;
    case "FX":
      return `FX rate (${pythSymbol}).`;
    default:
      return `Price in USD (${pythSymbol}).`;
  }
}

/** Display name from first keyword (e.g. "gold" → "Gold", "btc" → "Bitcoin"). */
const KEYWORD_TO_DISPLAY: Record<string, string> = {
  gold: "Gold", xau: "Gold",
  silver: "Silver", xag: "Silver",
  bitcoin: "Bitcoin", btc: "Bitcoin",
  ethereum: "Ethereum", eth: "Ethereum", ether: "Ethereum",
  solana: "Solana", sol: "Solana",
  chainlink: "Chainlink", link: "Chainlink",
  avalanche: "Avalanche", avax: "Avalanche",
  dogecoin: "Dogecoin", doge: "Dogecoin",
  cardano: "Cardano", ada: "Cardano",
  polkadot: "Polkadot", dot: "Polkadot",
  apple: "Apple", aapl: "Apple",
  tesla: "Tesla", tsla: "Tesla",
  microsoft: "Microsoft", msft: "Microsoft",
  nvidia: "Nvidia", nvda: "Nvidia",
  oil: "Crude Oil", crude: "Crude Oil", wti: "Crude Oil", brent: "Crude Oil", petroleum: "Crude Oil",
  euro: "Euro", eur: "Euro", eurusd: "Euro", "eur/usd": "Euro", euros: "Euro",
};

function displayNameFor(entry: PythFeedEntry): string {
  const first = entry.keywords[0];
  if (!first) return entry.symbol.split("/")[0] ?? entry.symbol;
  return KEYWORD_TO_DISPLAY[first] ?? first.charAt(0).toUpperCase() + first.slice(1);
}

/** List of supported assets with standard display name, token symbol, and description. */
export function getSupportedAssets(): SupportedAsset[] {
  const seen = new Set<string>();
  return PYTH_FEED_MAP.map((entry) => {
    const displayName = displayNameFor(entry);
    const key = entry.symbol;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      displayName,
      tokenSymbol: toTokenSymbol(entry.symbol),
      description: standardDescription(displayName, entry.symbol, entry.assetType),
      pythSymbol: entry.symbol,
      assetType: entry.assetType,
    };
  }).filter((a): a is SupportedAsset => a !== null);
}

/** Validate an asset name (static map + optional Pyth search). Returns standard fields if we can pull the asset. */
export async function validateAsset(assetName: string): Promise<
  | { valid: true; displayName: string; tokenSymbol: string; description: string; pythSymbol: string }
  | { valid: false; message: string; suggestions: string[] }
> {
  const supported = getSupportedAssets();
  const suggestions = supported.map((a) => a.displayName);

  const result = await getPythPrice(assetName.trim());
  if (!result) {
    return {
      valid: false,
      message: "We can't pull price data for this asset. Please choose one of our supported assets.",
      suggestions,
    };
  }

  const base = result.symbol.split("/")[0] ?? result.symbol;
  const tokenSymbol = "s" + base;
  const displayName = assetName.trim() || base;
  const description = standardDescription(displayName, result.symbol, result.assetType);

  return {
    valid: true,
    displayName,
    tokenSymbol,
    description,
    pythSymbol: result.symbol,
  };
}

/** Sync check: is this asset in our static list? (Used for server-side create-market guard.) */
export function isSupportedAssetName(assetName: string): boolean {
  return resolveFeedEntry(assetName) !== null;
}
