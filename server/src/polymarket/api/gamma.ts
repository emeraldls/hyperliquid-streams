// Gamma API Client - Market Discovery
// https://gamma-api.polymarket.com

import { POLYMARKET_CONFIG } from "../config";

const BASE_URL = POLYMARKET_CONFIG.urls.gamma;

export interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description: string;
  resolutionSource: string;
  startDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  openInterest: number;
  createdAt: string;
  competitive: number;
  volume24hr: number;
  enableOrderBook: boolean;
  liquidityClob: number;
  negRisk: boolean;
  commentCount: number;
  markets: GammaMarket[];
  tags: GammaTag[];
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource: string;
  endDate: string;
  liquidity: string;
  startDate: string;
  image: string;
  icon: string;
  description: string;
  outcomes: string; // JSON string like '["Yes", "No"]'
  outcomePrices: string; // JSON string like '[0.65, 0.35]'
  volume: string;
  active: boolean;
  closed: boolean;
  marketMakerAddress: string;
  createdAt: string;
  updatedAt: string;
  new: boolean;
  featured: boolean;
  archived: boolean;
  restricted: boolean;
  questionID: string;
  enableOrderBook: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  volumeNum: number;
  liquidityNum: number;
  endDateIso: string;
  startDateIso: string;
  volume24hr: number;
  clobTokenIds: string; // JSON string like '["token1", "token2"]'
  liquidityClob: number;
  negRisk: boolean;
  competitive: number;
  spread: number;
  oneDayPriceChange: number;
  lastTradePrice: number;
  bestBid: number;
  bestAsk: number;
}

export interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

export interface FetchEventsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  order?: "volume" | "liquidity" | "startDate" | "endDate" | "createdAt";
  ascending?: boolean;
  tag_slug?: string;
}

export interface FetchMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  order?: "volume" | "liquidity" | "startDate" | "endDate" | "createdAt";
  ascending?: boolean;
  clob_token_ids?: string;
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
        `[GammaAPI] Request failed (attempt ${i + 1}/${retries}):`,
        err
      );

      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const filtered = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null
  );

  if (filtered.length === 0) return "";

  return (
    "?" +
    filtered
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join("&")
  );
}

export async function fetchEvents(
  params: FetchEventsParams = {}
): Promise<GammaEvent[]> {
  const queryString = buildQueryString(
    params as Record<string, string | number | boolean | undefined | null>
  );
  const url = `${BASE_URL}/events${queryString}`;

  console.log(`[GammaAPI] Fetching events: ${url}`);

  const events = await fetchWithRetry<GammaEvent[]>(url);

  console.log(`[GammaAPI] Fetched ${events.length} events`);

  return events;
}

export async function fetchEvent(id: string): Promise<GammaEvent | null> {
  const url = `${BASE_URL}/events/${encodeURIComponent(id)}`;

  console.log(`[GammaAPI] Fetching event: ${url}`);

  try {
    const event = await fetchWithRetry<GammaEvent>(url);
    return event;
  } catch (err) {
    console.error(`[GammaAPI] Failed to fetch event ${id}:`, err);
    return null;
  }
}

export async function fetchEventBySlug(
  slug: string
): Promise<GammaEvent | null> {
  const url = `${BASE_URL}/events?slug=${encodeURIComponent(slug)}`;

  console.log(`[GammaAPI] Fetching event by slug: ${url}`);

  try {
    const events = await fetchWithRetry<GammaEvent[]>(url);
    return events[0] ?? null;
  } catch (err) {
    console.error(`[GammaAPI] Failed to fetch event by slug ${slug}:`, err);
    return null;
  }
}

export async function fetchMarkets(
  params: FetchMarketsParams = {}
): Promise<GammaMarket[]> {
  const queryString = buildQueryString(
    params as Record<string, string | number | boolean | undefined | null>
  );
  const url = `${BASE_URL}/markets${queryString}`;

  console.log(`[GammaAPI] Fetching markets: ${url}`);

  const markets = await fetchWithRetry<GammaMarket[]>(url);

  console.log(`[GammaAPI] Fetched ${markets.length} markets`);

  return markets;
}

export async function fetchMarket(id: string): Promise<GammaMarket | null> {
  const url = `${BASE_URL}/markets/${encodeURIComponent(id)}`;

  console.log(`[GammaAPI] Fetching market: ${url}`);

  try {
    const market = await fetchWithRetry<GammaMarket>(url);
    return market;
  } catch (err) {
    console.error(`[GammaAPI] Failed to fetch market ${id}:`, err);
    return null;
  }
}

export async function fetchMarketBySlug(
  slug: string
): Promise<GammaMarket | null> {
  const url = `${BASE_URL}/markets?slug=${encodeURIComponent(slug)}`;

  console.log(`[GammaAPI] Fetching market by slug: ${url}`);

  try {
    const markets = await fetchWithRetry<GammaMarket[]>(url);
    return markets[0] ?? null;
  } catch (err) {
    console.error(`[GammaAPI] Failed to fetch market by slug ${slug}:`, err);
    return null;
  }
}

// Fetch all events with pagination (for initial sync)
export async function fetchAllEvents(
  maxPages: number = 100
): Promise<GammaEvent[]> {
  const allEvents: GammaEvent[] = [];
  const limit = POLYMARKET_CONFIG.pagination.maxLimit;
  let offset = 0;

  console.log(`[GammaAPI] Starting full events sync...`);

  for (let page = 0; page < maxPages; page++) {
    const events = await fetchEvents({ limit, offset, closed: false, active: true });

    if (events.length === 0) {
      break;
    }

    allEvents.push(...events);
    offset += limit;

    console.log(
      `[GammaAPI] Fetched page ${page + 1}, total events: ${allEvents.length}`
    );

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[GammaAPI] Full sync complete. Total events: ${allEvents.length}`);

  return allEvents;
}

// Fetch all markets with pagination (for initial sync)
export async function fetchAllMarkets(
  maxPages: number = 100
): Promise<GammaMarket[]> {
  const allMarkets: GammaMarket[] = [];
  const limit = POLYMARKET_CONFIG.pagination.maxLimit;
  let offset = 0;

  console.log(`[GammaAPI] Starting full markets sync...`);

  for (let page = 0; page < maxPages; page++) {
    const markets = await fetchMarkets({ limit, offset, active: true, closed: false });

    if (markets.length === 0) {
      break;
    }

    allMarkets.push(...markets);
    offset += limit;

    console.log(
      `[GammaAPI] Fetched page ${page + 1}, total markets: ${allMarkets.length}`
    );

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(
    `[GammaAPI] Full sync complete. Total markets: ${allMarkets.length}`
  );

  return allMarkets;
}
