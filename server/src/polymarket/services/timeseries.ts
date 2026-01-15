// Timeseries Service
// Handles fetching, caching, and serving price history data

import {
  getPolymarketDB,
  type PriceHistoryPointRow,
} from "../db";
import {
  fetchPriceHistory,
  type ClobPriceHistoryPoint,
} from "../api/clob";
import {
  POLYMARKET_INTERVALS,
  type PolymarketInterval,
} from "../config";

export interface TimeseriesParams {
  tokenId: string;
  startTs?: number;
  endTs?: number;
  interval?: PolymarketInterval;
  fidelity?: number;
}

export interface TimeseriesPoint {
  t: number; // timestamp
  p: number; // price
}

export interface TimeseriesResult {
  data: TimeseriesPoint[];
  cached: boolean;
  fetchedRanges: number; // number of ranges fetched from API
}

// Default values
const DEFAULT_INTERVAL: PolymarketInterval = "1d";
const DEFAULT_FIDELITY = 60; // 60 minutes

/**
 * Get timeseries data with caching
 *
 * Flow:
 * 1. Check what ranges are already cached in DB
 * 2. Identify gaps that need fetching
 * 3. Fetch missing ranges from Polymarket API
 * 4. Store new points and record fetched ranges
 * 5. Return merged result from DB
 */
export async function getTimeseries(
  params: TimeseriesParams
): Promise<TimeseriesResult> {
  const db = await getPolymarketDB();

  const {
    tokenId,
    interval = DEFAULT_INTERVAL,
    fidelity = DEFAULT_FIDELITY,
  } = params;

  // Calculate default time range (last 24 hours)
  const now = Math.floor(Date.now() / 1000);
  const endTs = params.endTs ?? now;
  const startTs = params.startTs ?? (endTs - 24 * 60 * 60); // 24 hours ago

  console.log(`[Timeseries] Getting data for ${tokenId}, range: ${startTs} - ${endTs}, interval: ${interval}`);

  // Find gaps in cached data
  const uncachedRanges = await db.findUncachedRanges(tokenId, startTs, endTs, interval);

  let fetchedRanges = 0;

  // Fetch any missing ranges
  for (const range of uncachedRanges) {
    console.log(`[Timeseries] Fetching uncached range: ${range.startTs} - ${range.endTs}`);

    try {
      const points = await fetchPriceHistory({
        tokenId,
        startTs: range.startTs,
        endTs: range.endTs,
        fidelity,
      });

      if (points.length > 0) {
        // Convert to DB format
        const dbPoints: PriceHistoryPointRow[] = points.map((p: ClobPriceHistoryPoint) => ({
          token_id: tokenId,
          timestamp: p.t,
          price: p.p,
          source: "api",
        }));

        // Store points
        await db.insertPriceHistoryPoints(dbPoints);

        // Record the fetched range
        await db.recordFetchedRange({
          token_id: tokenId,
          start_ts: range.startTs,
          end_ts: range.endTs,
          interval,
          fidelity,
          point_count: points.length,
        });

        console.log(`[Timeseries] Stored ${points.length} points for range ${range.startTs} - ${range.endTs}`);
        fetchedRanges++;
      } else {
        // Even if no points, record the range to avoid re-fetching
        await db.recordFetchedRange({
          token_id: tokenId,
          start_ts: range.startTs,
          end_ts: range.endTs,
          interval,
          fidelity,
          point_count: 0,
        });
        console.log(`[Timeseries] No points for range ${range.startTs} - ${range.endTs}, recorded as empty`);
      }
    } catch (err) {
      console.error(`[Timeseries] Failed to fetch range ${range.startTs} - ${range.endTs}:`, err);
    }
  }

  // Now retrieve all data from DB
  const dbPoints = await db.getPriceHistory({
    tokenId,
    startTs,
    endTs,
  });

  // Convert to response format
  const data: TimeseriesPoint[] = dbPoints.map((p) => ({
    t: p.timestamp,
    p: p.price,
  }));

  return {
    data,
    cached: uncachedRanges.length === 0,
    fetchedRanges,
  };
}

/**
 * Append a real-time price update from WebSocket
 */
export async function appendRealtimePrice(
  tokenId: string,
  timestamp: number,
  price: number
): Promise<void> {
  const db = await getPolymarketDB();
  await db.appendPriceHistoryPoint(tokenId, timestamp, price, "ws");
}

/**
 * Get cache coverage info for a token
 */
export async function getCacheCoverage(
  tokenId: string,
  interval: string = DEFAULT_INTERVAL
): Promise<{
  ranges: { startTs: number; endTs: number }[];
  totalPoints: number;
}> {
  const db = await getPolymarketDB();

  const cachedRanges = await db.getCachedRanges(tokenId, interval);
  const ranges = cachedRanges.map((r) => ({
    startTs: r.start_ts,
    endTs: r.end_ts,
  }));

  const totalPoints = await db.getPriceHistoryCount(tokenId);

  return { ranges, totalPoints };
}

/**
 * Validate interval parameter
 */
export function isValidPolymarketInterval(
  interval: string
): interval is PolymarketInterval {
  return POLYMARKET_INTERVALS.includes(interval as PolymarketInterval);
}
