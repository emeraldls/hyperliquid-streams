// Polymarket API Configuration
import dotenv from "dotenv";
dotenv.config();

export const POLYMARKET_CONFIG = {
  // API Base URLs
  urls: {
    gamma: "https://gamma-api.polymarket.com",
    clob: "https://clob.polymarket.com",
    wss: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    data: "https://data-api.polymarket.com", // For future use (user positions)
  },

  // Sync intervals (milliseconds)
  sync: {
    marketsInterval: 60 * 1000 * 1000, // 1 minute
    eventsInterval: 60 * 1000 * 1000, // 1 minute
    priceHistoryBackfillDays: 30, // How far back to fetch on first run
  },

  // Cache staleness thresholds (milliseconds)
  staleness: {
    markets: 60 * 1000, // 1 minute
    events: 60 * 1000, // 1 minute
    priceHistory: 0, // Always serve from cache, real-time via WS
    orderbook: 0, // Always real-time via WS
    trades: 0, // Always real-time via WS
  },

  // WebSocket reconnection settings
  ws: {
    reconnectBaseDelay: 1000, // 1 second
    reconnectMaxDelay: 30000, // 30 seconds
    reconnectMaxAttempts: 10,
    pingInterval: 30000, // 30 seconds
  },

  // API pagination defaults
  pagination: {
    defaultLimit: 50,
    maxLimit: 100,
  },

  // Database URL (PostgreSQL)
  database: {
    url: process.env.DATABASE_URL || "",
  },
} as const;

// Candle interval definitions
export const CANDLE_INTERVALS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS;

// Valid intervals array for validation
export const VALID_INTERVALS: CandleInterval[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
];

// Polymarket price history intervals (what they provide)
export const POLYMARKET_INTERVALS = ["1h", "6h", "1d", "1w", "max"] as const;
export type PolymarketInterval = (typeof POLYMARKET_INTERVALS)[number];

// Candle aggregation hierarchy (from smaller to larger)
export const CANDLE_AGGREGATION_ORDER: CandleInterval[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
];

// Helper to get interval seconds
export function getIntervalSeconds(interval: CandleInterval): number {
  return CANDLE_INTERVALS[interval];
}

// Helper to get interval start timestamp (floor to interval boundary)
export function getIntervalStart(
  timestamp: number,
  interval: CandleInterval
): number {
  const seconds = CANDLE_INTERVALS[interval];
  return Math.floor(timestamp / seconds) * seconds;
}

// Helper to validate interval string
export function isValidInterval(interval: string): interval is CandleInterval {
  return VALID_INTERVALS.includes(interval as CandleInterval);
}
