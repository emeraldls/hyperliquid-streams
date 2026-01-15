// Markets REST API Routes
// GET /api/pm/markets - List markets
// GET /api/pm/markets/:id - Get single market
// GET /api/pm/markets/:id/candles - Get OHLCV candles
// GET /api/pm/markets/:id/timeseries - Get price timeseries (line chart)
// GET /api/pm/markets/:id/trades - Get recent trades
// GET /api/pm/markets/:id/orderbook - Get current orderbook

import { Router, type Request, type Response } from "express";
import { getPolymarketDB } from "../db";
import { POLYMARKET_CONFIG, isValidInterval, type CandleInterval } from "../config";
import { getCandlesWithFallback } from "../services/candles";
import { getCachedOrderbook } from "../ws/server";
import { fetchOrderbook } from "../api/clob";
import { getTimeseries, isValidPolymarketInterval } from "../services/timeseries";

const router = Router();

// GET /api/pm/markets - List markets
router.get("/", (req: Request, res: Response) => {
  const db = getPolymarketDB();

  // Parse query parameters
  const activeParam = req.query.active as string | undefined;
  const closedParam = req.query.closed as string | undefined;
  const eventId = req.query.eventId as string | undefined;
  const limitParam = req.query.limit as string | undefined;
  const offsetParam = req.query.offset as string | undefined;

  const limit = Math.min(
    parseInt(limitParam || String(POLYMARKET_CONFIG.pagination.defaultLimit), 10),
    POLYMARKET_CONFIG.pagination.maxLimit
  );
  const offset = parseInt(offsetParam || "0", 10);

  // Build filter params
  const params: {
    active?: boolean;
    closed?: boolean;
    eventId?: string;
    limit?: number;
    offset?: number;
  } = {
    limit,
    offset,
  };

  if (activeParam !== undefined) {
    params.active = activeParam === "true" || activeParam === "1";
  }

  // Default to closed: false (only return open markets) unless explicitly requested
  if (closedParam !== undefined) {
    params.closed = closedParam === "true" || closedParam === "1";
  } else {
    // Default: exclude closed markets
    params.closed = false;
  }

  if (eventId) {
    params.eventId = eventId;
  }

  try {
    const markets = db.getMarkets(params);

    // Parse market data
    const parsedMarkets = markets.map((market) => {
      let fullData = null;
      try {
        if (market.raw_data) {
          fullData = JSON.parse(market.raw_data);
        }
      } catch {
        // Ignore parse errors
      }

      let outcomes = [];
      let outcomePrices = [];
      let tokenIds = [];

      try {
        if (market.outcomes) outcomes = JSON.parse(market.outcomes);
        if (market.outcome_prices) outcomePrices = JSON.parse(market.outcome_prices);
        if (market.token_ids) tokenIds = JSON.parse(market.token_ids);
      } catch {
        // Ignore parse errors
      }

      return {
        id: market.id,
        eventId: market.event_id,
        question: market.question,
        slug: market.slug,
        outcomes,
        outcomePrices,
        tokenIds,
        active: Boolean(market.active),
        closed: Boolean(market.closed),
        volume: market.volume,
        liquidity: market.liquidity,
        createdAt: market.created_at,
        updatedAt: market.updated_at,
        // Additional fields
        bestBid: fullData?.bestBid,
        bestAsk: fullData?.bestAsk,
        lastTradePrice: fullData?.lastTradePrice,
        spread: fullData?.spread,
        oneDayPriceChange: fullData?.oneDayPriceChange,
      };
    });

    res.json({
      data: parsedMarkets,
      pagination: {
        limit,
        offset,
        total: parsedMarkets.length,
      },
    });
  } catch (err) {
    console.error("[MarketsAPI] Failed to get markets:", err);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/pm/markets/:id - Get single market
router.get("/:id", (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  try {
    // Try by ID first, then by slug
    let market = db.getMarketById(id);

    if (!market) {
      market = db.getMarketBySlug(id);
    }

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Parse market data
    let fullData = null;
    try {
      if (market.raw_data) {
        fullData = JSON.parse(market.raw_data);
      }
    } catch {
      // Ignore parse errors
    }

    let outcomes = [];
    let outcomePrices = [];
    let tokenIds = [];

    try {
      if (market.outcomes) outcomes = JSON.parse(market.outcomes);
      if (market.outcome_prices) outcomePrices = JSON.parse(market.outcome_prices);
      if (market.token_ids) tokenIds = JSON.parse(market.token_ids);
    } catch {
      // Ignore parse errors
    }

    res.json({
      id: market.id,
      eventId: market.event_id,
      question: market.question,
      slug: market.slug,
      outcomes,
      outcomePrices,
      tokenIds,
      active: Boolean(market.active),
      closed: Boolean(market.closed),
      volume: market.volume,
      liquidity: market.liquidity,
      createdAt: market.created_at,
      updatedAt: market.updated_at,
      // Additional fields from raw_data
      bestBid: fullData?.bestBid,
      bestAsk: fullData?.bestAsk,
      lastTradePrice: fullData?.lastTradePrice,
      spread: fullData?.spread,
      oneDayPriceChange: fullData?.oneDayPriceChange,
      oneHourPriceChange: fullData?.oneHourPriceChange,
      oneWeekPriceChange: fullData?.oneWeekPriceChange,
    });
  } catch (err) {
    console.error("[MarketsAPI] Failed to get market:", err);
    res.status(500).json({ error: "Failed to fetch market" });
  }
});

// GET /api/pm/markets/:id/candles - Get OHLCV candles
router.get("/:id/candles", (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  // Parse query parameters
  const intervalParam = (req.query.interval as string) || "1h";
  const startTimeParam = req.query.startTime as string | undefined;
  const endTimeParam = req.query.endTime as string | undefined;
  const limitParam = req.query.limit as string | undefined;

  // Validate interval
  if (!isValidInterval(intervalParam)) {
    res.status(400).json({
      error: "Invalid interval. Valid values: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w",
    });
    return;
  }

  const interval = intervalParam as CandleInterval;
  const startTime = startTimeParam ? parseInt(startTimeParam, 10) : undefined;
  const endTime = endTimeParam ? parseInt(endTimeParam, 10) : undefined;
  const limit = limitParam ? parseInt(limitParam, 10) : 500;

  try {
    // First, get the market to find token IDs
    let market = db.getMarketById(id);
    if (!market) {
      market = db.getMarketBySlug(id);
    }

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Get token ID (use first token ID, typically "Yes" outcome)
    let tokenIds: string[] = [];
    try {
      if (market.token_ids) {
        tokenIds = JSON.parse(market.token_ids);
      }
    } catch {
      // Ignore parse errors
    }

    if (tokenIds.length === 0) {
      res.status(400).json({ error: "Market has no token IDs" });
      return;
    }

    const tokenId = tokenIds[0];

    // Get candles
    const candles = getCandlesWithFallback(
      tokenId,
      interval,
      startTime,
      endTime,
      limit
    );

    // Format response
    const formattedCandles = candles.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      tradeCount: c.trade_count,
    }));

    res.json({
      marketId: market.id,
      tokenId,
      interval,
      data: formattedCandles,
    });
  } catch (err) {
    console.error("[MarketsAPI] Failed to get candles:", err);
    res.status(500).json({ error: "Failed to fetch candles" });
  }
});

// GET /api/pm/markets/:id/timeseries - Get price timeseries (for line charts)
router.get("/:id/timeseries", async (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  // Parse query parameters
  const startTsParam = req.query.startTs as string | undefined;
  const endTsParam = req.query.endTs as string | undefined;
  const intervalParam = (req.query.interval as string) || "1d";
  const fidelityParam = req.query.fidelity as string | undefined;

  // Validate interval
  if (!isValidPolymarketInterval(intervalParam)) {
    res.status(400).json({
      error: "Invalid interval. Valid values: 1h, 6h, 1d, 1w, max",
    });
    return;
  }

  const startTs = startTsParam ? parseInt(startTsParam, 10) : undefined;
  const endTs = endTsParam ? parseInt(endTsParam, 10) : undefined;
  const fidelity = fidelityParam ? parseInt(fidelityParam, 10) : undefined;

  try {
    // First, get the market to find token IDs
    let market = db.getMarketById(id);
    if (!market) {
      market = db.getMarketBySlug(id);
    }

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Check if market is closed
    if (market.closed) {
      res.json({
        marketId: market.id,
        tokenId: null,
        interval: intervalParam,
        data: [],
        cached: true,
        message: "Market is closed - no timeseries data available",
      });
      return;
    }

    // Get token ID
    let tokenIds: string[] = [];
    try {
      if (market.token_ids) {
        tokenIds = JSON.parse(market.token_ids);
      }
    } catch {
      // Ignore parse errors
    }

    if (tokenIds.length === 0) {
      res.json({
        marketId: market.id,
        tokenId: null,
        interval: intervalParam,
        data: [],
        cached: true,
        message: "Market has no token IDs",
      });
      return;
    }

    const tokenId = tokenIds[0];

    // Get timeseries with caching
    const result = await getTimeseries({
      tokenId,
      startTs,
      endTs,
      interval: intervalParam,
      fidelity,
    });

    res.json({
      marketId: market.id,
      tokenId,
      interval: intervalParam,
      data: result.data,
      cached: result.cached,
      fetchedRanges: result.fetchedRanges,
    });
  } catch (err) {
    console.error("[MarketsAPI] Failed to get timeseries:", err);
    res.status(500).json({ error: "Failed to fetch timeseries" });
  }
});

// GET /api/pm/markets/:id/trades - Get recent trades
router.get("/:id/trades", (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  // Parse query parameters
  const limitParam = req.query.limit as string | undefined;
  const beforeParam = req.query.before as string | undefined;

  const limit = Math.min(parseInt(limitParam || "100", 10), 500);
  const before = beforeParam ? parseInt(beforeParam, 10) : undefined;

  try {
    // First, get the market to find token IDs
    let market = db.getMarketById(id);
    if (!market) {
      market = db.getMarketBySlug(id);
    }

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Get token ID
    let tokenIds: string[] = [];
    try {
      if (market.token_ids) {
        tokenIds = JSON.parse(market.token_ids);
      }
    } catch {
      // Ignore parse errors
    }

    if (tokenIds.length === 0) {
      res.status(400).json({ error: "Market has no token IDs" });
      return;
    }

    const tokenId = tokenIds[0];

    // Get trades from database
    const trades = db.getTrades({
      tokenId,
      limit,
      before,
    });

    // Format response
    const formattedTrades = trades.map((t) => ({
      id: t.id,
      price: t.price,
      size: t.size,
      side: t.side,
      timestamp: t.timestamp,
    }));

    res.json({
      marketId: market.id,
      tokenId,
      data: formattedTrades,
    });
  } catch (err) {
    console.error("[MarketsAPI] Failed to get trades:", err);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

// GET /api/pm/markets/:id/orderbook - Get current orderbook
router.get("/:id/orderbook", async (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  try {
    // First, get the market to find token IDs
    let market = db.getMarketById(id);
    if (!market) {
      market = db.getMarketBySlug(id);
    }

    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    // Parse raw_data to check enableOrderBook flag
    let enableOrderBook = true;
    try {
      if (market.raw_data) {
        const rawData = JSON.parse(market.raw_data);
        enableOrderBook = rawData.enableOrderBook !== false;
      }
    } catch {
      // Ignore parse errors
    }

    // Check if market is closed - closed markets don't have orderbooks
    if (market.closed) {
      res.json({
        marketId: market.id,
        tokenId: null,
        bids: [],
        asks: [],
        timestamp: Date.now(),
        hasOrderbook: false,
        reason: "Market is closed",
      });
      return;
    }

    // Get token ID
    let tokenIds: string[] = [];
    try {
      if (market.token_ids) {
        tokenIds = JSON.parse(market.token_ids);
      }
    } catch {
      // Ignore parse errors
    }

    if (tokenIds.length === 0) {
      res.json({
        marketId: market.id,
        tokenId: null,
        bids: [],
        asks: [],
        timestamp: Date.now(),
        hasOrderbook: false,
        reason: "Market has no token IDs",
      });
      return;
    }

    const tokenId = tokenIds[0];

    // Check if orderbook is disabled for this market
    if (!enableOrderBook) {
      res.json({
        marketId: market.id,
        tokenId,
        bids: [],
        asks: [],
        timestamp: Date.now(),
        hasOrderbook: false,
        reason: "Orderbook not enabled for this market",
      });
      return;
    }

    // Try to get from cache first
    const cached = getCachedOrderbook(tokenId);

    if (cached) {
      res.json({
        marketId: market.id,
        tokenId,
        bids: cached.bids,
        asks: cached.asks,
        timestamp: cached.timestamp,
        hasOrderbook: true,
        source: "cache",
      });
      return;
    }

    // Try to get from database
    const snapshot = db.getLatestOrderbookSnapshot(tokenId);

    if (snapshot) {
      try {
        const bids = JSON.parse(snapshot.bids || "[]");
        const asks = JSON.parse(snapshot.asks || "[]");

        res.json({
          marketId: market.id,
          tokenId,
          bids,
          asks,
          timestamp: snapshot.timestamp,
          hasOrderbook: true,
          source: "database",
        });
        return;
      } catch {
        // Fall through to fetch from API
      }
    }

    // Fetch from Polymarket CLOB API
    const orderbook = await fetchOrderbook(tokenId);

    if (orderbook) {
      const bids = orderbook.bids.map((b) => [
        parseFloat(b.price),
        parseFloat(b.size),
      ]);
      const asks = orderbook.asks.map((a) => [
        parseFloat(a.price),
        parseFloat(a.size),
      ]);

      res.json({
        marketId: market.id,
        tokenId,
        bids,
        asks,
        timestamp: new Date(orderbook.timestamp).getTime(),
        hasOrderbook: true,
        source: "api",
      });
    } else {
      // No orderbook available from any source - return empty with flag
      res.json({
        marketId: market.id,
        tokenId,
        bids: [],
        asks: [],
        timestamp: Date.now(),
        hasOrderbook: false,
        reason: "Orderbook not available",
      });
    }
  } catch (err) {
    console.error("[MarketsAPI] Failed to get orderbook:", err);
    res.status(500).json({ error: "Failed to fetch orderbook" });
  }
});

export default router;
