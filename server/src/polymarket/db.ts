import { Pool } from "pg";
import { POLYMARKET_CONFIG, type CandleInterval } from "./config";

export class PolymarketDB {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: POLYMARKET_CONFIG.database.url,
    });
    console.log("[PolymarketDB] PostgreSQL pool created");
  }

  async bootstrapTables() {
    const schema = `
      -- Events from Gamma API
      CREATE TABLE IF NOT EXISTS pm_events (
        id TEXT PRIMARY KEY,
        slug TEXT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        start_date TEXT,
        end_date TEXT,
        image_url TEXT,
        active BOOLEAN DEFAULT TRUE,
        closed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        raw_data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pm_events_active ON pm_events(active);
      CREATE INDEX IF NOT EXISTS idx_pm_events_slug ON pm_events(slug);

      -- Markets linked to events
      CREATE TABLE IF NOT EXISTS pm_markets (
        id TEXT PRIMARY KEY,
        event_id TEXT REFERENCES pm_events(id),
        question TEXT NOT NULL,
        slug TEXT,
        outcomes TEXT,
        outcome_prices TEXT,
        token_ids TEXT,
        active BOOLEAN DEFAULT TRUE,
        closed BOOLEAN DEFAULT FALSE,
        volume TEXT,
        liquidity TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        raw_data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pm_markets_event ON pm_markets(event_id);
      CREATE INDEX IF NOT EXISTS idx_pm_markets_active ON pm_markets(active);
      CREATE INDEX IF NOT EXISTS idx_pm_markets_slug ON pm_markets(slug);

      -- OHLCV candles
      CREATE TABLE IF NOT EXISTS pm_price_candles (
        id SERIAL PRIMARY KEY,
        token_id TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        interval TEXT NOT NULL,
        open DOUBLE PRECISION,
        high DOUBLE PRECISION,
        low DOUBLE PRECISION,
        close DOUBLE PRECISION,
        volume DOUBLE PRECISION,
        trade_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, timestamp, interval)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_candles_token_time ON pm_price_candles(token_id, interval, timestamp DESC);

      -- Raw trades for candle aggregation
      CREATE TABLE IF NOT EXISTS pm_trades (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        size DOUBLE PRECISION NOT NULL,
        side TEXT,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pm_trades_token_time ON pm_trades(token_id, timestamp DESC);

      -- Orderbook snapshots (optional)
      CREATE TABLE IF NOT EXISTS pm_orderbook_snapshots (
        id SERIAL PRIMARY KEY,
        token_id TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        bids TEXT,
        asks TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pm_orderbook_token_time ON pm_orderbook_snapshots(token_id, timestamp DESC);

      -- Sync state tracking
      CREATE TABLE IF NOT EXISTS pm_sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Raw price history points (from timeseries API)
      CREATE TABLE IF NOT EXISTS pm_price_history (
        id SERIAL PRIMARY KEY,
        token_id TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        source TEXT DEFAULT 'api',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_price_history_token_time ON pm_price_history(token_id, timestamp DESC);

      -- Track fetched ranges to avoid re-fetching
      CREATE TABLE IF NOT EXISTS pm_price_history_ranges (
        id SERIAL PRIMARY KEY,
        token_id TEXT NOT NULL,
        start_ts BIGINT NOT NULL,
        end_ts BIGINT NOT NULL,
        interval TEXT NOT NULL,
        fidelity INTEGER,
        point_count INTEGER DEFAULT 0,
        fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, start_ts, end_ts, interval)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_price_history_ranges_token ON pm_price_history_ranges(token_id, interval);
    `;

    await this.pool.query(schema);
  }

  // ==================== EVENTS ====================

  async upsertEvent(event: EventRow) {
    const query = `
      INSERT INTO pm_events (id, slug, title, description, category, start_date, end_date, image_url, active, closed, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        slug = EXCLUDED.slug,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        image_url = EXCLUDED.image_url,
        active = EXCLUDED.active,
        closed = EXCLUDED.closed,
        raw_data = EXCLUDED.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `;

    await this.pool.query(query, [
      event.id,
      event.slug ?? null,
      event.title,
      event.description ?? null,
      event.category ?? null,
      event.start_date ?? null,
      event.end_date ?? null,
      event.image_url ?? null,
      event.active ?? true,
      event.closed ?? false,
      event.raw_data ?? null,
    ]);
  }

  async getEvents(params: {
    active?: boolean;
    closed?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = "SELECT * FROM pm_events WHERE 1=1";
    const queryParams: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (params.active !== undefined) {
      query += ` AND active = $${paramIndex++}`;
      queryParams.push(params.active);
    }

    if (params.closed !== undefined) {
      query += ` AND closed = $${paramIndex++}`;
      queryParams.push(params.closed);
    }

    if (params.category) {
      query += ` AND category = $${paramIndex++}`;
      queryParams.push(params.category);
    }

    query += " ORDER BY updated_at DESC";

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    const result = await this.pool.query(query, queryParams);
    return result.rows as EventRow[];
  }

  async getEventById(id: string) {
    const result = await this.pool.query(
      "SELECT * FROM pm_events WHERE id = $1",
      [id]
    );
    return result.rows[0] as EventRow | undefined;
  }

  async getEventBySlug(slug: string) {
    const result = await this.pool.query(
      "SELECT * FROM pm_events WHERE slug = $1",
      [slug]
    );
    return result.rows[0] as EventRow | undefined;
  }

  // Get all unique categories with event counts
  async getCategories(excludeClosed: boolean = true) {
    let query = `
      SELECT category, COUNT(*) as count
      FROM pm_events
      WHERE category IS NOT NULL AND category != ''
    `;
    if (excludeClosed) {
      query += " AND closed = FALSE";
    }
    query += " GROUP BY category ORDER BY count DESC";

    const result = await this.pool.query(query);
    return result.rows as { category: string; count: number }[];
  }

  // Search events by title or description
  async searchEvents(params: {
    query: string;
    closed?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    const searchTerm = `%${params.query}%`;
    let sql = `
      SELECT * FROM pm_events
      WHERE (title ILIKE $1 OR description ILIKE $2)
    `;
    const queryParams: (string | number | boolean)[] = [searchTerm, searchTerm];
    let paramIndex = 3;

    if (params.closed !== undefined) {
      sql += ` AND closed = $${paramIndex++}`;
      queryParams.push(params.closed);
    }

    if (params.category) {
      sql += ` AND category = $${paramIndex++}`;
      queryParams.push(params.category);
    }

    sql += " ORDER BY updated_at DESC";

    if (params.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    const result = await this.pool.query(sql, queryParams);
    return result.rows as EventRow[];
  }

  // Search markets by question
  async searchMarkets(params: {
    query: string;
    closed?: boolean;
    eventId?: string;
    limit?: number;
    offset?: number;
  }) {
    const searchTerm = `%${params.query}%`;
    let sql = "SELECT * FROM pm_markets WHERE question ILIKE $1";
    const queryParams: (string | number | boolean)[] = [searchTerm];
    let paramIndex = 2;

    if (params.closed !== undefined) {
      sql += ` AND closed = $${paramIndex++}`;
      queryParams.push(params.closed);
    }

    if (params.eventId) {
      sql += ` AND event_id = $${paramIndex++}`;
      queryParams.push(params.eventId);
    }

    sql += " ORDER BY updated_at DESC";

    if (params.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    const result = await this.pool.query(sql, queryParams);
    return result.rows as MarketRow[];
  }

  // ==================== MARKETS ====================

  async upsertMarket(market: MarketRow) {
    const query = `
      INSERT INTO pm_markets (id, event_id, question, slug, outcomes, outcome_prices, token_ids, active, closed, volume, liquidity, raw_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        event_id = EXCLUDED.event_id,
        question = EXCLUDED.question,
        slug = EXCLUDED.slug,
        outcomes = EXCLUDED.outcomes,
        outcome_prices = EXCLUDED.outcome_prices,
        token_ids = EXCLUDED.token_ids,
        active = EXCLUDED.active,
        closed = EXCLUDED.closed,
        volume = EXCLUDED.volume,
        liquidity = EXCLUDED.liquidity,
        raw_data = EXCLUDED.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `;

    await this.pool.query(query, [
      market.id,
      market.event_id ?? null,
      market.question,
      market.slug ?? null,
      market.outcomes ?? null,
      market.outcome_prices ?? null,
      market.token_ids ?? null,
      market.active ?? true,
      market.closed ?? false,
      market.volume ?? null,
      market.liquidity ?? null,
      market.raw_data ?? null,
    ]);
  }

  async getMarkets(params: {
    eventId?: string;
    active?: boolean;
    closed?: boolean;
    limit?: number;
    offset?: number;
  }) {
    let query = "SELECT * FROM pm_markets WHERE 1=1";
    const queryParams: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (params.eventId) {
      query += ` AND event_id = $${paramIndex++}`;
      queryParams.push(params.eventId);
    }

    if (params.active !== undefined) {
      query += ` AND active = $${paramIndex++}`;
      queryParams.push(params.active);
    }

    if (params.closed !== undefined) {
      query += ` AND closed = $${paramIndex++}`;
      queryParams.push(params.closed);
    }

    query += " ORDER BY updated_at DESC";

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    const result = await this.pool.query(query, queryParams);
    return result.rows as MarketRow[];
  }

  async getMarketById(id: string) {
    const result = await this.pool.query(
      "SELECT * FROM pm_markets WHERE id = $1",
      [id]
    );
    return result.rows[0] as MarketRow | undefined;
  }

  async getMarketBySlug(slug: string) {
    const result = await this.pool.query(
      "SELECT * FROM pm_markets WHERE slug = $1",
      [slug]
    );
    return result.rows[0] as MarketRow | undefined;
  }

  async getMarketsByEventId(eventId: string, excludeClosed: boolean = true) {
    let query = "SELECT * FROM pm_markets WHERE event_id = $1";
    if (excludeClosed) {
      query += " AND closed = FALSE";
    }
    query += " ORDER BY updated_at DESC";
    const result = await this.pool.query(query, [eventId]);
    return result.rows as MarketRow[];
  }

  // ==================== CANDLES ====================

  async upsertCandle(candle: CandleRow) {
    const query = `
      INSERT INTO pm_price_candles (token_id, timestamp, interval, open, high, low, close, volume, trade_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT(token_id, timestamp, interval) DO UPDATE SET
        open = COALESCE(pm_price_candles.open, EXCLUDED.open),
        high = GREATEST(COALESCE(pm_price_candles.high, 0), EXCLUDED.high),
        low = CASE
          WHEN pm_price_candles.low IS NULL THEN EXCLUDED.low
          WHEN EXCLUDED.low IS NULL THEN pm_price_candles.low
          ELSE LEAST(pm_price_candles.low, EXCLUDED.low)
        END,
        close = EXCLUDED.close,
        volume = COALESCE(pm_price_candles.volume, 0) + COALESCE(EXCLUDED.volume, 0),
        trade_count = COALESCE(pm_price_candles.trade_count, 0) + COALESCE(EXCLUDED.trade_count, 0)
    `;

    await this.pool.query(query, [
      candle.token_id,
      candle.timestamp,
      candle.interval,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.trade_count,
    ]);
  }

  async getCandles(params: {
    tokenId: string;
    interval: CandleInterval;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) {
    let query =
      "SELECT * FROM pm_price_candles WHERE token_id = $1 AND interval = $2";
    const queryParams: (string | number)[] = [params.tokenId, params.interval];
    let paramIndex = 3;

    if (params.startTime !== undefined) {
      query += ` AND timestamp >= $${paramIndex++}`;
      queryParams.push(params.startTime);
    }

    if (params.endTime !== undefined) {
      query += ` AND timestamp <= $${paramIndex++}`;
      queryParams.push(params.endTime);
    }

    query += " ORDER BY timestamp ASC";

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    const result = await this.pool.query(query, queryParams);
    return result.rows as CandleRow[];
  }

  async getLatestCandle(tokenId: string, interval: CandleInterval) {
    const result = await this.pool.query(
      `
      SELECT * FROM pm_price_candles
      WHERE token_id = $1 AND interval = $2
      ORDER BY timestamp DESC LIMIT 1
    `,
      [tokenId, interval]
    );
    return result.rows[0] as CandleRow | undefined;
  }

  // Get candles for aggregation (used to build larger timeframes)
  async getCandlesForAggregation(
    tokenId: string,
    sourceInterval: CandleInterval,
    startTime: number,
    endTime: number
  ) {
    const result = await this.pool.query(
      `
      SELECT * FROM pm_price_candles
      WHERE token_id = $1 AND interval = $2 AND timestamp >= $3 AND timestamp < $4
      ORDER BY timestamp ASC
    `,
      [tokenId, sourceInterval, startTime, endTime]
    );
    return result.rows as CandleRow[];
  }

  // ==================== TRADES ====================

  async insertTrade(trade: TradeRow) {
    const query = `
      INSERT INTO pm_trades (id, token_id, price, size, side, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(id) DO NOTHING
    `;

    await this.pool.query(query, [
      trade.id,
      trade.token_id,
      trade.price,
      trade.size,
      trade.side,
      trade.timestamp,
    ]);
  }

  async getTrades(params: { tokenId: string; limit?: number; before?: number }) {
    let query = "SELECT * FROM pm_trades WHERE token_id = $1";
    const queryParams: (string | number)[] = [params.tokenId];
    let paramIndex = 2;

    if (params.before !== undefined) {
      query += ` AND timestamp < $${paramIndex++}`;
      queryParams.push(params.before);
    }

    query += " ORDER BY timestamp DESC";

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    const result = await this.pool.query(query, queryParams);
    return result.rows as TradeRow[];
  }

  async getTradesInRange(tokenId: string, startTime: number, endTime: number) {
    const result = await this.pool.query(
      `
      SELECT * FROM pm_trades
      WHERE token_id = $1 AND timestamp >= $2 AND timestamp < $3
      ORDER BY timestamp ASC
    `,
      [tokenId, startTime, endTime]
    );
    return result.rows as TradeRow[];
  }

  // ==================== ORDERBOOK SNAPSHOTS ====================

  async insertOrderbookSnapshot(snapshot: OrderbookSnapshotRow) {
    const query = `
      INSERT INTO pm_orderbook_snapshots (token_id, timestamp, bids, asks)
      VALUES ($1, $2, $3, $4)
    `;

    await this.pool.query(query, [
      snapshot.token_id,
      snapshot.timestamp,
      snapshot.bids,
      snapshot.asks,
    ]);
  }

  async getLatestOrderbookSnapshot(tokenId: string) {
    const result = await this.pool.query(
      `
      SELECT * FROM pm_orderbook_snapshots
      WHERE token_id = $1
      ORDER BY timestamp DESC LIMIT 1
    `,
      [tokenId]
    );
    return result.rows[0] as OrderbookSnapshotRow | undefined;
  }

  // ==================== SYNC STATE ====================

  async getSyncState(key: string): Promise<string | null> {
    const result = await this.pool.query(
      "SELECT value FROM pm_sync_state WHERE key = $1",
      [key]
    );
    return result.rows[0]?.value ?? null;
  }

  async setSyncState(key: string, value: string) {
    const query = `
      INSERT INTO pm_sync_state (key, value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = CURRENT_TIMESTAMP
    `;
    await this.pool.query(query, [key, value]);
  }

  // ==================== PRICE HISTORY ====================

  // Batch insert price history points
  async insertPriceHistoryPoints(points: PriceHistoryPointRow[]) {
    if (points.length === 0) return;

    const query = `
      INSERT INTO pm_price_history (token_id, timestamp, price, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(token_id, timestamp) DO NOTHING
    `;

    for (const point of points) {
      await this.pool.query(query, [
        point.token_id,
        point.timestamp,
        point.price,
        point.source || "api",
      ]);
    }
  }

  // Append a single real-time price update
  async appendPriceHistoryPoint(
    tokenId: string,
    timestamp: number,
    price: number,
    source: string = "ws"
  ) {
    const query = `
      INSERT INTO pm_price_history (token_id, timestamp, price, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(token_id, timestamp) DO UPDATE SET
        price = EXCLUDED.price,
        source = EXCLUDED.source
    `;
    await this.pool.query(query, [tokenId, timestamp, price, source]);
  }

  // Get price history for a range
  async getPriceHistory(params: {
    tokenId: string;
    startTs: number;
    endTs: number;
    limit?: number;
  }): Promise<PriceHistoryPointRow[]> {
    let query = `
      SELECT * FROM pm_price_history
      WHERE token_id = $1 AND timestamp >= $2 AND timestamp <= $3
      ORDER BY timestamp ASC
    `;
    const queryParams: (string | number)[] = [
      params.tokenId,
      params.startTs,
      params.endTs,
    ];

    if (params.limit) {
      query += " LIMIT $4";
      queryParams.push(params.limit);
    }

    const result = await this.pool.query(query, queryParams);
    return result.rows as PriceHistoryPointRow[];
  }

  // Get cached ranges for a token
  async getCachedRanges(
    tokenId: string,
    interval: string
  ): Promise<PriceHistoryRangeRow[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM pm_price_history_ranges
      WHERE token_id = $1 AND interval = $2
      ORDER BY start_ts ASC
    `,
      [tokenId, interval]
    );
    return result.rows as PriceHistoryRangeRow[];
  }

  // Record a fetched range
  async recordFetchedRange(range: Omit<PriceHistoryRangeRow, "id" | "fetched_at">) {
    const query = `
      INSERT INTO pm_price_history_ranges (token_id, start_ts, end_ts, interval, fidelity, point_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(token_id, start_ts, end_ts, interval) DO UPDATE SET
        point_count = EXCLUDED.point_count,
        fetched_at = CURRENT_TIMESTAMP
    `;
    await this.pool.query(query, [
      range.token_id,
      range.start_ts,
      range.end_ts,
      range.interval,
      range.fidelity ?? null,
      range.point_count ?? 0,
    ]);
  }

  // Find gaps in cached data for a requested range
  async findUncachedRanges(
    tokenId: string,
    startTs: number,
    endTs: number,
    interval: string
  ): Promise<{ startTs: number; endTs: number }[]> {
    const cachedRanges = await this.getCachedRanges(tokenId, interval);

    if (cachedRanges.length === 0) {
      // No cached data at all - entire range is uncached
      return [{ startTs, endTs }];
    }

    const gaps: { startTs: number; endTs: number }[] = [];
    let currentStart = startTs;

    for (const range of cachedRanges) {
      // Skip ranges that end before our start
      if (range.end_ts < currentStart) continue;

      // Skip ranges that start after our end
      if (range.start_ts > endTs) break;

      // If there's a gap before this cached range
      if (range.start_ts > currentStart) {
        gaps.push({
          startTs: currentStart,
          endTs: Math.min(range.start_ts, endTs),
        });
      }

      // Move our pointer past this cached range
      currentStart = Math.max(currentStart, range.end_ts);

      // If we've covered the entire requested range, stop
      if (currentStart >= endTs) break;
    }

    // Check if there's a gap after all cached ranges
    if (currentStart < endTs) {
      gaps.push({
        startTs: currentStart,
        endTs: endTs,
      });
    }

    return gaps;
  }

  // Get count of price history points for a token
  async getPriceHistoryCount(tokenId: string): Promise<number> {
    const result = await this.pool.query(
      "SELECT COUNT(*) as count FROM pm_price_history WHERE token_id = $1",
      [tokenId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  // ==================== UTILITIES ====================

  async close() {
    await this.pool.end();
  }

  // Transaction wrapper
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

// Row types
export type EventRow = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
  image_url: string | null;
  active: boolean;
  closed: boolean;
  created_at: string;
  updated_at: string;
  raw_data: string | null;
};

export type MarketRow = {
  id: string;
  event_id: string | null;
  question: string;
  slug: string | null;
  outcomes: string | null; // JSON array
  outcome_prices: string | null; // JSON array
  token_ids: string | null; // JSON array
  active: boolean;
  closed: boolean;
  volume: string | null;
  liquidity: string | null;
  created_at: string;
  updated_at: string;
  raw_data: string | null;
};

export type CandleRow = {
  id?: number;
  token_id: string;
  timestamp: number;
  interval: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  trade_count: number;
  created_at?: string;
};

export type TradeRow = {
  id: string;
  token_id: string;
  price: number;
  size: number;
  side: string | null;
  timestamp: number;
  created_at?: string;
};

export type OrderbookSnapshotRow = {
  id?: number;
  token_id: string;
  timestamp: number;
  bids: string | null; // JSON array
  asks: string | null; // JSON array
  created_at?: string;
};

export type PriceHistoryPointRow = {
  id?: number;
  token_id: string;
  timestamp: number;
  price: number;
  source: string; // 'api' or 'ws'
  created_at?: string;
};

export type PriceHistoryRangeRow = {
  id?: number;
  token_id: string;
  start_ts: number;
  end_ts: number;
  interval: string;
  fidelity: number | null;
  point_count: number;
  fetched_at?: string;
};

// Singleton instance
let dbInstance: PolymarketDB | null = null;

export async function getPolymarketDB(): Promise<PolymarketDB> {
  if (!dbInstance) {
    dbInstance = new PolymarketDB();
    await dbInstance.bootstrapTables();
  }
  return dbInstance;
}
