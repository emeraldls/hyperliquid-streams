// CLOB API Client - Trading Data
// https://clob.polymarket.com

import { POLYMARKET_CONFIG, type PolymarketInterval } from "../config";

const BASE_URL = POLYMARKET_CONFIG.urls.clob;

export interface ClobOrderbook {
  market: string;
  asset_id: string;
  hash: string;
  timestamp: string;
  bids: ClobOrderbookLevel[];
  asks: ClobOrderbookLevel[];
}

export interface ClobOrderbookLevel {
  price: string;
  size: string;
}

export interface ClobPrice {
  price: string;
  side: string;
}

export interface ClobMidpoint {
  mid: string;
}

export interface ClobPriceHistoryPoint {
  t: number; // Unix timestamp
  p: number; // Price
}

export interface ClobTrade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: string; // "BUY" or "SELL"
  size: string;
  fee_rate_bps: string;
  price: string;
  status: string;
  match_time: string;
  last_update: string;
  outcome: string;
  bucket_index: number;
  owner: string;
  maker_address: string;
  transaction_hash: string;
  trader_side: string;
}

export interface ClobTradesResponse {
  data: ClobTrade[];
  next_cursor: string;
}

async function fetchWithRetry<T>(
  url: string,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err as Error;
      console.error(
        `[ClobAPI] Request failed (attempt ${i + 1}/${retries}):`,
        err
      );

      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export async function fetchOrderbook(
  tokenId: string
): Promise<ClobOrderbook | null> {
  const url = `${BASE_URL}/book?token_id=${encodeURIComponent(tokenId)}`;

  console.log(`[ClobAPI] Fetching orderbook for token: ${tokenId}`);

  try {
    const orderbook = await fetchWithRetry<ClobOrderbook>(url);
    return orderbook;
  } catch (err) {
    console.error(`[ClobAPI] Failed to fetch orderbook for ${tokenId}:`, err);
    return null;
  }
}

export async function fetchPrice(tokenId: string): Promise<string | null> {
  const url = `${BASE_URL}/price?token_id=${encodeURIComponent(tokenId)}`;

  console.log(`[ClobAPI] Fetching price for token: ${tokenId}`);

  try {
    const priceData = await fetchWithRetry<ClobPrice>(url);
    return priceData.price;
  } catch (err) {
    console.error(`[ClobAPI] Failed to fetch price for ${tokenId}:`, err);
    return null;
  }
}

export async function fetchMidpoint(tokenId: string): Promise<string | null> {
  const url = `${BASE_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`;

  console.log(`[ClobAPI] Fetching midpoint for token: ${tokenId}`);

  try {
    const midpointData = await fetchWithRetry<ClobMidpoint>(url);
    return midpointData.mid;
  } catch (err) {
    console.error(`[ClobAPI] Failed to fetch midpoint for ${tokenId}:`, err);
    return null;
  }
}

export interface FetchPriceHistoryParams {
  tokenId: string;
  interval?: PolymarketInterval;
  startTs?: number;
  endTs?: number;
  fidelity?: number; // minutes
}

export async function fetchPriceHistory(
  params: FetchPriceHistoryParams
): Promise<ClobPriceHistoryPoint[]> {
  const queryParams: string[] = [
    `market=${encodeURIComponent(params.tokenId)}`,
  ];

  if (params.interval) {
    queryParams.push(`interval=${params.interval}`);
  }

  if (params.startTs !== undefined) {
    queryParams.push(`startTs=${params.startTs}`);
  }

  if (params.endTs !== undefined) {
    queryParams.push(`endTs=${params.endTs}`);
  }

  if (params.fidelity !== undefined) {
    queryParams.push(`fidelity=${params.fidelity}`);
  }

  const url = `${BASE_URL}/prices-history?${queryParams.join("&")}`;

  console.log(`[ClobAPI] Fetching price history: ${url}`);

  try {
    const history = await fetchWithRetry<{ history: ClobPriceHistoryPoint[] }>(
      url
    );
    return history.history || [];
  } catch (err) {
    console.error(
      `[ClobAPI] Failed to fetch price history for ${params.tokenId}:`,
      err
    );
    return [];
  }
}

export interface FetchTradesParams {
  tokenId: string;
  limit?: number;
  cursor?: string;
}

export async function fetchTrades(
  params: FetchTradesParams
): Promise<ClobTradesResponse> {
  const queryParams: string[] = [
    `market=${encodeURIComponent(params.tokenId)}`,
  ];

  if (params.limit) {
    queryParams.push(`limit=${params.limit}`);
  }

  if (params.cursor) {
    queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`);
  }

  const url = `${BASE_URL}/trades?${queryParams.join("&")}`;

  console.log(`[ClobAPI] Fetching trades: ${url}`);

  try {
    const response = await fetchWithRetry<ClobTradesResponse>(url);
    return response;
  } catch (err) {
    console.error(
      `[ClobAPI] Failed to fetch trades for ${params.tokenId}:`,
      err
    );
    return { data: [], next_cursor: "" };
  }
}

// Fetch all trades with pagination (for backfill)
export async function fetchAllTrades(
  tokenId: string,
  maxTrades: number = 1000
): Promise<ClobTrade[]> {
  const allTrades: ClobTrade[] = [];
  let cursor: string | undefined;
  const limit = 100;

  console.log(`[ClobAPI] Fetching all trades for token: ${tokenId}`);

  while (allTrades.length < maxTrades) {
    const response = await fetchTrades({ tokenId, limit, cursor });

    if (response.data.length === 0) {
      break;
    }

    allTrades.push(...response.data);

    if (!response.next_cursor || response.next_cursor === cursor) {
      break;
    }

    cursor = response.next_cursor;

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(
    `[ClobAPI] Fetched ${allTrades.length} trades for token: ${tokenId}`
  );

  return allTrades;
}

// Fetch price history for backfilling candles
export async function fetchFullPriceHistory(
  tokenId: string,
  days: number = 30
): Promise<ClobPriceHistoryPoint[]> {
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - days * 24 * 60 * 60;

  console.log(
    `[ClobAPI] Fetching full price history for ${tokenId}, ${days} days`
  );

  // Start with finest granularity available (1 minute fidelity)
  const history = await fetchPriceHistory({
    tokenId,
    startTs,
    endTs,
    fidelity: 1, // 1 minute
  });

  console.log(
    `[ClobAPI] Fetched ${history.length} price history points for ${tokenId}`
  );

  return history;
}

// Get multiple token prices at once
export async function fetchMultiplePrices(
  tokenIds: string[]
): Promise<Map<string, string>> {
  const prices = new Map<string, string>();

  // Fetch prices in parallel with a small batch size to avoid rate limits
  const batchSize = 10;

  for (let i = 0; i < tokenIds.length; i += batchSize) {
    const batch = tokenIds.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (tokenId) => {
        const price = await fetchPrice(tokenId);
        return { tokenId, price };
      })
    );

    for (const { tokenId, price } of results) {
      if (price !== null) {
        prices.set(tokenId, price);
      }
    }

    // Small delay between batches
    if (i + batchSize < tokenIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return prices;
}
