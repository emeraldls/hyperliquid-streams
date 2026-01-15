// Sync Service - Background Jobs for Polymarket Data
// Fetches and stores markets/events from Polymarket APIs

import { getPolymarketDB, type EventRow, type MarketRow } from "../db";
import {
  fetchAllEvents,
  fetchAllMarkets,
  type GammaEvent,
  type GammaMarket,
} from "../api/gamma";
import { fetchFullPriceHistory, fetchAllTrades } from "../api/clob";
import { POLYMARKET_CONFIG } from "../config";
import { processTradesIntoCandles, aggregateAllCandles } from "./candles";

let eventsIntervalId: NodeJS.Timeout | null = null;
let marketsIntervalId: NodeJS.Timeout | null = null;
let isSyncing = false;

// Convert Gamma Event to DB row
function eventToRow(event: GammaEvent): EventRow {
  // Get first tag as category
  const category = event.tags?.[0]?.label ?? null;

  return {
    id: event.id,
    slug: event.slug ?? null,
    title: event.title ?? "Untitled",
    description: event.description ?? null,
    category,
    start_date: event.startDate ?? null,
    end_date: event.endDate ?? null,
    image_url: event.image ?? null,
    active: event.active ?? true,
    closed: event.closed ?? false,
    created_at: event.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_data: JSON.stringify(event),
  };
}

// Helper to safely stringify a value for DB
function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    // Check if it's already a valid JSON string
    try {
      JSON.parse(value);
      return value;
    } catch {
      // Not valid JSON, stringify it
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

// Convert Gamma Market to DB row
function marketToRow(market: GammaMarket, eventId?: string): MarketRow {
  return {
    id: market.conditionId || market.id,
    event_id: eventId ?? null,
    question: market.question ?? "",
    slug: market.slug ?? null,
    outcomes: toJsonString(market.outcomes),
    outcome_prices: toJsonString(market.outcomePrices),
    token_ids: toJsonString(market.clobTokenIds),
    active: market.active ?? true,
    closed: market.closed ?? false,
    volume: market.volume ?? null,
    liquidity: market.liquidity ?? null,
    created_at: market.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_data: JSON.stringify(market),
  };
}

// Sync events from Gamma API
export async function syncEvents(): Promise<number> {
  console.log("[SyncService] Starting events sync...");

  const db = await getPolymarketDB();
  const startTime = Date.now();

  try {
    const events = await fetchAllEvents();

    // Store events and their embedded markets
    let eventCount = 0;
    let marketCount = 0;

    for (const event of events) {
      if (event.active === false && event.closed === true) {
        console.log("[SyncService] Skipping fully closed event:", event.id);
        // Skip fully closed events
        continue;
      }
      const eventRow = eventToRow(event);
      await db.upsertEvent(eventRow);
      eventCount++;

      // Also store markets embedded in events
      if (event.markets && event.markets.length > 0) {
        for (const market of event.markets) {
          const marketRow = marketToRow(market as GammaMarket, event.id);
          await db.upsertMarket(marketRow);
          marketCount++;
        }
      }
    }

    // Update sync state
    await db.setSyncState("events_last_sync", new Date().toISOString());

    const duration = Date.now() - startTime;
    console.log(
      `[SyncService] Events sync complete: ${eventCount} events, ${marketCount} markets in ${duration}ms`
    );

    return eventCount;
  } catch (err) {
    console.error("[SyncService] Events sync failed:", err);
    throw err;
  }
}

// Sync markets from Gamma API
export async function syncMarkets(): Promise<number> {
  console.log("[SyncService] Starting markets sync...");

  const db = await getPolymarketDB();
  const startTime = Date.now();

  try {
    const markets = await fetchAllMarkets();

    let marketCount = 0;

    for (const market of markets) {
      const marketRow = marketToRow(market);
      await db.upsertMarket(marketRow);
      marketCount++;
    }

    // Update sync state
    await db.setSyncState("markets_last_sync", new Date().toISOString());

    const duration = Date.now() - startTime;
    console.log(
      `[SyncService] Markets sync complete: ${marketCount} markets in ${duration}ms`
    );

    return marketCount;
  } catch (err) {
    console.error("[SyncService] Markets sync failed:", err);
    throw err;
  }
}

// Backfill price history for a token
export async function backfillPriceHistory(tokenId: string): Promise<number> {
  console.log(`[SyncService] Backfilling price history for token: ${tokenId}`);

  const db = await getPolymarketDB();
  const startTime = Date.now();

  try {
    const days = POLYMARKET_CONFIG.sync.priceHistoryBackfillDays;
    const priceHistory = await fetchFullPriceHistory(tokenId, days);

    // Convert price history points to candle updates
    let candleCount = 0;
    for (const point of priceHistory) {
      // Create 1m candle from price point
      await db.upsertCandle({
        token_id: tokenId,
        timestamp: point.t,
        interval: "1m",
        open: point.p,
        high: point.p,
        low: point.p,
        close: point.p,
        volume: 0,
        trade_count: 0,
      });
      candleCount++;
    }

    // Aggregate into larger timeframes
    await aggregateAllCandles(tokenId);

    const duration = Date.now() - startTime;
    console.log(
      `[SyncService] Price history backfill complete for ${tokenId}: ${candleCount} points in ${duration}ms`
    );

    return candleCount;
  } catch (err) {
    console.error(
      `[SyncService] Price history backfill failed for ${tokenId}:`,
      err
    );
    throw err;
  }
}

// Backfill trades for a token
export async function backfillTrades(tokenId: string): Promise<number> {
  console.log(`[SyncService] Backfilling trades for token: ${tokenId}`);

  const db = await getPolymarketDB();
  const startTime = Date.now();

  try {
    const trades = await fetchAllTrades(tokenId, 1000);

    let tradeCount = 0;
    for (const trade of trades) {
      await db.insertTrade({
        id: trade.id,
        token_id: trade.asset_id,
        price: parseFloat(trade.price),
        size: parseFloat(trade.size),
        side: trade.side,
        timestamp: new Date(trade.match_time).getTime(),
      });
      tradeCount++;
    }

    // Process trades into candles
    if (tradeCount > 0) {
      await processTradesIntoCandles(
        tokenId,
        trades.map((t) => ({
          id: t.id,
          token_id: t.asset_id,
          price: parseFloat(t.price),
          size: parseFloat(t.size),
          side: t.side,
          timestamp: new Date(t.match_time).getTime(),
        }))
      );
    }

    const duration = Date.now() - startTime;
    console.log(
      `[SyncService] Trades backfill complete for ${tokenId}: ${tradeCount} trades in ${duration}ms`
    );

    return tradeCount;
  } catch (err) {
    console.error(`[SyncService] Trades backfill failed for ${tokenId}:`, err);
    throw err;
  }
}

// Full sync - run on startup
export async function runFullSync(): Promise<void> {
  if (isSyncing) {
    console.log("[SyncService] Full sync already in progress, skipping");
    return;
  }

  isSyncing = true;

  console.log("[SyncService] Starting full sync...");
  const startTime = Date.now();

  try {
    // Sync events first (includes embedded markets)
    await syncEvents();

    // Then sync markets separately (may have markets not in events)
    await syncMarkets();

    const duration = Date.now() - startTime;
    console.log(`[SyncService] Full sync complete in ${duration}ms`);
  } catch (err) {
    console.error("[SyncService] Full sync failed:", err);
  } finally {
    isSyncing = false;
  }
}

// Check if data is stale and needs refresh
export async function isDataStale(key: "markets" | "events"): Promise<boolean> {
  const db = await getPolymarketDB();
  const lastSync = await db.getSyncState(`${key}_last_sync`);

  if (!lastSync) {
    return true;
  }

  const lastSyncTime = new Date(lastSync).getTime();
  const staleness =
    key === "markets"
      ? POLYMARKET_CONFIG.staleness.markets
      : POLYMARKET_CONFIG.staleness.events;

  return Date.now() - lastSyncTime > staleness;
}

// Start periodic sync jobs
export function startSyncJobs(): void {
  console.log("[SyncService] Starting background sync jobs...");

  // Run initial sync
  runFullSync();

  // Schedule periodic events sync
  eventsIntervalId = setInterval(() => {
    if (!isSyncing) {
      syncEvents().catch((err) => {
        console.error("[SyncService] Periodic events sync failed:", err);
      });
    }
  }, POLYMARKET_CONFIG.sync.eventsInterval);

  // Schedule periodic markets sync
  marketsIntervalId = setInterval(() => {
    if (!isSyncing) {
      syncMarkets().catch((err) => {
        console.error("[SyncService] Periodic markets sync failed:", err);
      });
    }
  }, POLYMARKET_CONFIG.sync.marketsInterval);

  console.log(
    `[SyncService] Sync jobs scheduled (events: ${POLYMARKET_CONFIG.sync.eventsInterval}ms, markets: ${POLYMARKET_CONFIG.sync.marketsInterval}ms)`
  );
}

// Stop periodic sync jobs
export function stopSyncJobs(): void {
  console.log("[SyncService] Stopping background sync jobs...");

  if (eventsIntervalId) {
    clearInterval(eventsIntervalId);
    eventsIntervalId = null;
  }

  if (marketsIntervalId) {
    clearInterval(marketsIntervalId);
    marketsIntervalId = null;
  }
}

// Get sync status
export async function getSyncStatus(): Promise<{
  eventsLastSync: string | null;
  marketsLastSync: string | null;
  isCurrentlySyncing: boolean;
}> {
  const db = await getPolymarketDB();

  return {
    eventsLastSync: await db.getSyncState("events_last_sync"),
    marketsLastSync: await db.getSyncState("markets_last_sync"),
    isCurrentlySyncing: isSyncing,
  };
}
