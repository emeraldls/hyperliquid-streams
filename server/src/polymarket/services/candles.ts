// Candle Aggregation Service
// Processes trades into OHLCV candles and aggregates across timeframes

import {
  getPolymarketDB,
  type CandleRow,
  type TradeRow,
} from "../db";
import {
  CANDLE_INTERVALS,
  CANDLE_AGGREGATION_ORDER,
  getIntervalStart,
  type CandleInterval,
} from "../config";

// Process a single trade into 1m candle
export function processTradeIntoCandle(trade: TradeRow): void {
  const db = getPolymarketDB();

  // Get the start of the 1-minute candle
  const candleTimestamp = getIntervalStart(
    Math.floor(trade.timestamp / 1000),
    "1m"
  );

  // Get existing candle or create new one
  const existingCandle = db.getLatestCandle(trade.token_id, "1m");

  if (existingCandle && existingCandle.timestamp === candleTimestamp) {
    // Update existing candle
    db.upsertCandle({
      token_id: trade.token_id,
      timestamp: candleTimestamp,
      interval: "1m",
      open: existingCandle.open, // Keep original open
      high: Math.max(existingCandle.high ?? 0, trade.price),
      low: Math.min(existingCandle.low ?? Infinity, trade.price),
      close: trade.price, // Update close to latest
      volume: (existingCandle.volume ?? 0) + trade.size,
      trade_count: (existingCandle.trade_count ?? 0) + 1,
    });
  } else {
    // Create new candle
    db.upsertCandle({
      token_id: trade.token_id,
      timestamp: candleTimestamp,
      interval: "1m",
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.size,
      trade_count: 1,
    });
  }
}

// Process multiple trades into candles (batch processing)
export async function processTradesIntoCandles(
  tokenId: string,
  trades: TradeRow[]
): Promise<void> {
  if (trades.length === 0) return;

  console.log(
    `[CandleService] Processing ${trades.length} trades into candles for ${tokenId}`
  );

  const db = getPolymarketDB();

  // Group trades by 1-minute intervals
  const candleMap = new Map<
    number,
    {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      trade_count: number;
      firstTimestamp: number;
    }
  >();

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sortedTrades) {
    const candleTimestamp = getIntervalStart(
      Math.floor(trade.timestamp / 1000),
      "1m"
    );

    const existing = candleMap.get(candleTimestamp);

    if (existing) {
      existing.high = Math.max(existing.high, trade.price);
      existing.low = Math.min(existing.low, trade.price);
      existing.close = trade.price;
      existing.volume += trade.size;
      existing.trade_count += 1;
    } else {
      candleMap.set(candleTimestamp, {
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.size,
        trade_count: 1,
        firstTimestamp: trade.timestamp,
      });
    }
  }

  // Insert all candles in a transaction
  db.transaction(() => {
    for (const [timestamp, candle] of candleMap) {
      db.upsertCandle({
        token_id: tokenId,
        timestamp,
        interval: "1m",
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        trade_count: candle.trade_count,
      });
    }
  });

  console.log(
    `[CandleService] Created/updated ${candleMap.size} 1m candles for ${tokenId}`
  );

  // Aggregate into larger timeframes
  await aggregateAllCandles(tokenId);
}

// Aggregate candles from smaller to larger timeframes
export function aggregateCandles(
  tokenId: string,
  sourceInterval: CandleInterval,
  targetInterval: CandleInterval,
  startTime?: number,
  endTime?: number
): number {
  const db = getPolymarketDB();

  const sourceSeconds = CANDLE_INTERVALS[sourceInterval];
  const targetSeconds = CANDLE_INTERVALS[targetInterval];

  if (targetSeconds <= sourceSeconds) {
    console.error(
      `[CandleService] Cannot aggregate from ${sourceInterval} to ${targetInterval}`
    );
    return 0;
  }

  // Determine time range
  const now = Math.floor(Date.now() / 1000);
  const effectiveEndTime = endTime ?? now;
  const effectiveStartTime =
    startTime ?? effectiveEndTime - 30 * 24 * 60 * 60; // 30 days back

  // Get source candles
  const sourceCandles = db.getCandles({
    tokenId,
    interval: sourceInterval,
    startTime: effectiveStartTime,
    endTime: effectiveEndTime,
  });

  if (sourceCandles.length === 0) {
    return 0;
  }

  // Group source candles by target interval boundaries
  const targetCandleMap = new Map<
    number,
    {
      open: number | null;
      high: number;
      low: number;
      close: number | null;
      volume: number;
      trade_count: number;
      firstTimestamp: number;
    }
  >();

  for (const candle of sourceCandles) {
    const targetTimestamp = getIntervalStart(candle.timestamp, targetInterval);

    const existing = targetCandleMap.get(targetTimestamp);

    if (existing) {
      // Update aggregated candle
      if (candle.timestamp < existing.firstTimestamp) {
        existing.open = candle.open;
        existing.firstTimestamp = candle.timestamp;
      }
      existing.high = Math.max(existing.high, candle.high ?? 0);
      existing.low = Math.min(
        existing.low,
        candle.low ?? Number.MAX_SAFE_INTEGER
      );
      existing.close = candle.close; // Always update close to latest
      existing.volume += candle.volume ?? 0;
      existing.trade_count += candle.trade_count ?? 0;
    } else {
      targetCandleMap.set(targetTimestamp, {
        open: candle.open,
        high: candle.high ?? 0,
        low: candle.low ?? Number.MAX_SAFE_INTEGER,
        close: candle.close,
        volume: candle.volume ?? 0,
        trade_count: candle.trade_count ?? 0,
        firstTimestamp: candle.timestamp,
      });
    }
  }

  // Insert aggregated candles
  let count = 0;
  db.transaction(() => {
    for (const [timestamp, candle] of targetCandleMap) {
      if (candle.open === null || candle.close === null) continue;

      db.upsertCandle({
        token_id: tokenId,
        timestamp,
        interval: targetInterval,
        open: candle.open,
        high: candle.high,
        low: candle.low === Number.MAX_SAFE_INTEGER ? null : candle.low,
        close: candle.close,
        volume: candle.volume,
        trade_count: candle.trade_count,
      });
      count++;
    }
  });

  return count;
}

// Aggregate all timeframes for a token
export async function aggregateAllCandles(tokenId: string): Promise<void> {
  console.log(`[CandleService] Aggregating all candles for ${tokenId}`);

  // Aggregate in order: 1m -> 5m -> 15m -> 30m -> 1h -> 4h -> 1d -> 1w
  const intervals = CANDLE_AGGREGATION_ORDER;

  for (let i = 0; i < intervals.length - 1; i++) {
    const source = intervals[i];
    const target = intervals[i + 1];

    const count = aggregateCandles(tokenId, source, target);

    if (count > 0) {
      console.log(
        `[CandleService] Aggregated ${count} ${target} candles from ${source} for ${tokenId}`
      );
    }
  }
}

// Get candles for a token with automatic aggregation if needed
export function getCandlesWithFallback(
  tokenId: string,
  interval: CandleInterval,
  startTime?: number,
  endTime?: number,
  limit?: number
): CandleRow[] {
  const db = getPolymarketDB();

  // First try to get candles for the requested interval
  let candles = db.getCandles({
    tokenId,
    interval,
    startTime,
    endTime,
    limit,
  });

  // If no candles found, try to aggregate from smaller intervals
  if (candles.length === 0) {
    console.log(
      `[CandleService] No ${interval} candles found for ${tokenId}, attempting aggregation`
    );

    // Find the smallest interval with data
    const intervals = CANDLE_AGGREGATION_ORDER;
    const targetIndex = intervals.indexOf(interval);

    for (let i = 0; i < targetIndex; i++) {
      const sourceInterval = intervals[i];
      const sourceCandles = db.getCandles({
        tokenId,
        interval: sourceInterval,
        startTime,
        endTime,
      });

      if (sourceCandles.length > 0) {
        console.log(
          `[CandleService] Found ${sourceCandles.length} ${sourceInterval} candles, aggregating up to ${interval}`
        );

        // Aggregate all the way up to target interval
        for (let j = i; j < targetIndex; j++) {
          aggregateCandles(
            tokenId,
            intervals[j],
            intervals[j + 1],
            startTime,
            endTime
          );
        }

        // Fetch aggregated candles
        candles = db.getCandles({
          tokenId,
          interval,
          startTime,
          endTime,
          limit,
        });

        break;
      }
    }
  }

  return candles;
}

// Update candles when a new trade comes in from WebSocket
export function handleRealtimeTrade(trade: {
  tokenId: string;
  price: number;
  size: number;
  side: string;
  timestamp: number;
}): void {
  const db = getPolymarketDB();

  // Store the trade
  db.insertTrade({
    id: `ws_${trade.timestamp}_${Math.random().toString(36).slice(2)}`,
    token_id: trade.tokenId,
    price: trade.price,
    size: trade.size,
    side: trade.side,
    timestamp: trade.timestamp,
  });

  // Update 1m candle
  processTradeIntoCandle({
    id: "",
    token_id: trade.tokenId,
    price: trade.price,
    size: trade.size,
    side: trade.side,
    timestamp: trade.timestamp,
  });

  // Note: We don't aggregate larger timeframes on every trade for performance
  // Larger timeframes are aggregated periodically or on-demand
}

// Periodic aggregation job - should be run every few minutes
export function runPeriodicAggregation(tokenIds: string[]): void {
  console.log(
    `[CandleService] Running periodic aggregation for ${tokenIds.length} tokens`
  );

  for (const tokenId of tokenIds) {
    try {
      // Only aggregate the most recent candles (last hour)
      const now = Math.floor(Date.now() / 1000);
      const oneHourAgo = now - 3600;

      const intervals = CANDLE_AGGREGATION_ORDER;

      for (let i = 0; i < intervals.length - 1; i++) {
        aggregateCandles(
          tokenId,
          intervals[i],
          intervals[i + 1],
          oneHourAgo,
          now
        );
      }
    } catch (err) {
      console.error(
        `[CandleService] Periodic aggregation failed for ${tokenId}:`,
        err
      );
    }
  }
}
