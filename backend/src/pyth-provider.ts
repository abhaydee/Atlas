/**
 * Pyth Network price provider — pulls real-time prices from Pyth Hermes REST API.
 *
 * All feed IDs below were live-tested against:
 *   https://hermes.pyth.network/v2/updates/price/latest?ids[]=<id>&parsed=true
 *
 * No API key required. Prices are aggregated across 20+ market makers and
 * updated every ~400ms on Pythnet. Far more reliable than CoinGecko scraping.
 *
 * Dynamic search fallback: for assets not in the static map, the provider
 * queries /v2/price_feeds?query=<term> to discover a feed at runtime.
 */

const HERMES_BASE = "https://hermes.pyth.network";

export interface PythFeedEntry {
  feedId: string;
  symbol: string;            // e.g. "XAU/USD"
  assetType: string;         // e.g. "Metal", "Crypto", "Equity", "Commodities", "FX"
  benchmarksSymbol: string;  // Pyth Benchmarks API symbol e.g. "Metal.XAU/USD"
  keywords: string[];        // natural language terms that map to this feed
}

/**
 * Static map of confirmed, live-tested Pyth price feeds.
 * Keywords use lowercase for matching; add aliases freely.
 */
export const PYTH_FEED_MAP: PythFeedEntry[] = [
  // ── Metals ────────────────────────────────────────────────────────────────
  {
    feedId:           "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
    symbol:           "XAU/USD",
    assetType:        "Metal",
    benchmarksSymbol: "Metal.XAU/USD",
    keywords:         ["gold", "xau", "xauusd", "xau/usd"],
  },
  {
    feedId:           "f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e",
    symbol:           "XAG/USD",
    assetType:        "Metal",
    benchmarksSymbol: "Metal.XAG/USD",
    keywords:         ["silver", "xag", "xagusd", "xag/usd"],
  },

  // ── Crypto ────────────────────────────────────────────────────────────────
  {
    feedId:           "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    symbol:           "BTC/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.BTC/USD",
    keywords:         ["bitcoin", "btc", "btcusd", "btc/usd"],
  },
  {
    feedId:           "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    symbol:           "ETH/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.ETH/USD",
    keywords:         ["ethereum", "eth", "ethusd", "eth/usd", "ether"],
  },
  {
    feedId:           "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    symbol:           "SOL/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.SOL/USD",
    keywords:         ["solana", "sol", "solusd", "sol/usd"],
  },
  {
    feedId:           "8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
    symbol:           "LINK/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.LINK/USD",
    keywords:         ["chainlink", "link", "linkusd", "link/usd"],
  },
  {
    feedId:           "93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7",
    symbol:           "AVAX/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.AVAX/USD",
    keywords:         ["avalanche", "avax", "avaxusd", "avax/usd"],
  },
  {
    feedId:           "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
    symbol:           "DOGE/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.DOGE/USD",
    keywords:         ["dogecoin", "doge", "dogeusd", "doge/usd"],
  },
  {
    feedId:           "2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d",
    symbol:           "ADA/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.ADA/USD",
    keywords:         ["cardano", "ada", "adausd", "ada/usd"],
  },
  {
    feedId:           "ca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b",
    symbol:           "DOT/USD",
    assetType:        "Crypto",
    benchmarksSymbol: "Crypto.DOT/USD",
    keywords:         ["polkadot", "dot", "dotusd", "dot/usd"],
  },

  // ── US Equities ───────────────────────────────────────────────────────────
  {
    feedId:           "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    symbol:           "AAPL/USD",
    assetType:        "Equity",
    benchmarksSymbol: "Equity.US.AAPL/USD",
    keywords:         ["apple", "aapl", "aaplusd", "aapl/usd"],
  },
  {
    feedId:           "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    symbol:           "TSLA/USD",
    assetType:        "Equity",
    benchmarksSymbol: "Equity.US.TSLA/USD",
    keywords:         ["tesla", "tsla", "tslausd", "tsla/usd"],
  },
  {
    feedId:           "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
    symbol:           "MSFT/USD",
    assetType:        "Equity",
    benchmarksSymbol: "Equity.US.MSFT/USD",
    keywords:         ["microsoft", "msft", "msftusd", "msft/usd"],
  },
  {
    feedId:           "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    symbol:           "NVDA/USD",
    assetType:        "Equity",
    benchmarksSymbol: "Equity.US.NVDA/USD",
    keywords:         ["nvidia", "nvda", "nvdausd", "nvda/usd"],
  },

  // ── Commodities ───────────────────────────────────────────────────────────
  {
    feedId:           "0058c6f03fd28b18083d00fcdc3baaed2f11edef8b981f6b74130b85be474b17",
    symbol:           "WTI/USD",
    assetType:        "Commodities",
    benchmarksSymbol: "Commodities.WTIH6/USD",
    keywords:         ["oil", "crude", "wti", "crude oil", "petroleum", "brent"],
  },

  // ── FX ────────────────────────────────────────────────────────────────────
  {
    feedId:           "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
    symbol:           "EUR/USD",
    assetType:        "FX",
    benchmarksSymbol: "FX.EUR/USD",
    keywords:         ["euro", "eur", "eurusd", "eur/usd", "euros"],
  },
];

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Resolve a natural language asset name to a Pyth feed entry using keyword matching.
 * Returns null if no static match is found.
 */
export function resolveFeedEntry(assetName: string): PythFeedEntry | null {
  const lower = assetName.toLowerCase().trim();
  for (const entry of PYTH_FEED_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

/** Convenience alias: returns just the feedId string, or null. */
export function resolveFeedId(assetName: string): string | null {
  return resolveFeedEntry(assetName)?.feedId ?? null;
}

/**
 * Fetch the current USD price for a given Pyth feed ID from Hermes.
 * Applies the exponent: price = rawPrice * 10^expo
 * Returns null on any network or parse error.
 */
export async function fetchPythPrice(feedId: string): Promise<number | null> {
  try {
    const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      parsed: Array<{
        id: string;
        price: { price: string; conf: string; expo: number; publish_time: number };
        ema_price: { price: string; expo: number };
      }>;
    };

    const parsed = data.parsed?.[0];
    if (!parsed) return null;

    const raw  = parseInt(parsed.price.price, 10);
    const expo = parsed.price.expo;
    if (isNaN(raw)) return null;

    const price = raw * Math.pow(10, expo);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Fetch prices for multiple feed IDs in a single Hermes request.
 * Returns a map of feedId → price.
 */
export async function fetchPythPriceBatch(
  feedIds: string[]
): Promise<Record<string, number>> {
  if (feedIds.length === 0) return {};
  try {
    const params = feedIds.map((id) => `ids[]=${id}`).join("&");
    const url    = `${HERMES_BASE}/v2/updates/price/latest?${params}&parsed=true`;
    const res    = await fetch(url);
    if (!res.ok) return {};

    const data = (await res.json()) as {
      parsed: Array<{
        id: string;
        price: { price: string; expo: number };
      }>;
    };

    const result: Record<string, number> = {};
    for (const p of data.parsed ?? []) {
      const raw   = parseInt(p.price.price, 10);
      const expo  = p.price.expo;
      const price = raw * Math.pow(10, expo);
      if (!isNaN(raw) && price > 0) {
        // Pyth IDs may be returned with or without 0x prefix — normalise
        result[p.id.replace(/^0x/, "")] = price;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Search Pyth for a feed by free-text query (uses Hermes /v2/price_feeds).
 * Prefers Crypto and Metal asset types, picks the first result otherwise.
 * Returns null if no results found.
 */
export async function searchPythFeed(query: string): Promise<PythFeedEntry | null> {
  try {
    const url = `${HERMES_BASE}/v2/price_feeds?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const feeds = (await res.json()) as Array<{
      id: string;
      attributes: {
        asset_type?: string;
        symbol?: string;
        display_symbol?: string;
        base?: string;
        quote_currency?: string;
      };
    }>;

    if (!feeds.length) return null;

    // Prefer non-deprecated, non-RR feeds that have a simple base/USD pair
    const preferred = feeds.find((f) => {
      const sym = f.attributes.symbol ?? "";
      return (
        !sym.includes("DEPRECATED") &&
        !sym.includes(".RR") &&
        !sym.includes("POST") &&
        !sym.includes("PRE") &&
        !sym.includes(".ON")
      );
    }) ?? feeds[0];

    const attrs      = preferred.attributes;
    const assetType  = attrs.asset_type ?? "Unknown";
    const symbol     = attrs.display_symbol ?? attrs.symbol ?? query.toUpperCase();
    // Best-effort Benchmarks symbol — may not work for all dynamic feeds
    const benchmarksSymbol = `${assetType}.${symbol}`;
    return {
      feedId: preferred.id,
      symbol,
      assetType,
      benchmarksSymbol,
      keywords: [query.toLowerCase()],
    };
  } catch {
    return null;
  }
}

/**
 * Return the Pyth Benchmarks API symbol for a given feed ID, or null if unknown.
 * Used by the /chart endpoint to fetch historical OHLC data.
 */
export function getBenchmarksSymbol(feedId: string): string | null {
  const entry = PYTH_FEED_MAP.find((e) => e.feedId === feedId);
  return entry?.benchmarksSymbol ?? null;
}

/**
 * Fetch historical OHLC candles from the Pyth Benchmarks TradingView shim.
 *
 * @param benchmarksSymbol - e.g. "Crypto.BTC/USD", "Metal.XAU/USD"
 * @param resolution       - candle size in minutes ("5", "60", "D")
 * @param from             - unix timestamp (seconds)
 * @param to               - unix timestamp (seconds)
 */
export async function fetchPythHistory(
  benchmarksSymbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<{
  t: number[];   // timestamps (unix seconds)
  o: number[];   // open
  h: number[];   // high
  l: number[];   // low
  c: number[];   // close
} | null> {
  try {
    const url = `https://benchmarks.pyth.network/v1/shims/tradingview/history`
      + `?symbol=${encodeURIComponent(benchmarksSymbol)}`
      + `&resolution=${resolution}`
      + `&from=${from}&to=${to}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      s: string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
    };
    if (data.s !== "ok" || !data.t?.length) return null;
    return { t: data.t, o: data.o!, h: data.h!, l: data.l!, c: data.c! };
  } catch {
    return null;
  }
}

/**
 * High-level convenience: resolve or search for an asset, then fetch its price.
 * Returns full result with feedId and symbol so callers can store it for future use.
 *
 * Resolution order:
 *   1. Static keyword map (instant)
 *   2. Dynamic Hermes search (one HTTP call)
 *   3. null — asset truly unknown to Pyth
 */
export async function getPythPrice(assetName: string): Promise<{
  price: number;
  feedId: string;
  symbol: string;
  assetType: string;
  source: "static" | "dynamic";
} | null> {
  // 1. Static map
  const staticEntry = resolveFeedEntry(assetName);
  if (staticEntry) {
    const price = await fetchPythPrice(staticEntry.feedId);
    if (price !== null) {
      return { price, feedId: staticEntry.feedId, symbol: staticEntry.symbol, assetType: staticEntry.assetType, source: "static" };
    }
  }

  // 2. Dynamic search
  const dynamicEntry = await searchPythFeed(assetName);
  if (dynamicEntry) {
    const price = await fetchPythPrice(dynamicEntry.feedId);
    if (price !== null) {
      return { price, feedId: dynamicEntry.feedId, symbol: dynamicEntry.symbol, assetType: dynamicEntry.assetType, source: "dynamic" };
    }
  }

  return null;
}
