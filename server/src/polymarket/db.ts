import { DatabaseSync } from "node:sqlite";
import { POLYMARKET_CONFIG, type CandleInterval } from "./config";

export class PolymarketDB {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(POLYMARKET_CONFIG.database.path);
  }

  bootstrapTables() {
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
        active INTEGER DEFAULT 1,
        closed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
        active INTEGER DEFAULT 1,
        closed INTEGER DEFAULT 0,
        volume TEXT,
        liquidity TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        raw_data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pm_markets_event ON pm_markets(event_id);
      CREATE INDEX IF NOT EXISTS idx_pm_markets_active ON pm_markets(active);
      CREATE INDEX IF NOT EXISTS idx_pm_markets_slug ON pm_markets(slug);

      -- OHLCV candles
      CREATE TABLE IF NOT EXISTS pm_price_candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        interval TEXT NOT NULL,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume REAL,
        trade_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, timestamp, interval)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_candles_token_time ON pm_price_candles(token_id, interval, timestamp DESC);

      -- Raw trades for candle aggregation
      CREATE TABLE IF NOT EXISTS pm_trades (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        side TEXT,
        timestamp INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pm_trades_token_time ON pm_trades(token_id, timestamp DESC);

      -- Orderbook snapshots (optional)
      CREATE TABLE IF NOT EXISTS pm_orderbook_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        bids TEXT,
        asks TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pm_orderbook_token_time ON pm_orderbook_snapshots(token_id, timestamp DESC);

      -- Sync state tracking
      CREATE TABLE IF NOT EXISTS pm_sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Raw price history points (from timeseries API)
      CREATE TABLE IF NOT EXISTS pm_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        price REAL NOT NULL,
        source TEXT DEFAULT 'api',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_price_history_token_time ON pm_price_history(token_id, timestamp DESC);

      -- Track fetched ranges to avoid re-fetching
      CREATE TABLE IF NOT EXISTS pm_price_history_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        interval TEXT NOT NULL,
        fidelity INTEGER,
        point_count INTEGER DEFAULT 0,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_id, start_ts, end_ts, interval)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_price_history_ranges_token ON pm_price_history_ranges(token_id, interval);
    `;

    this.db.exec(schema);
  }

  // ==================== EVENTS ====================

  upsertEvent(event: EventRow) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_events (id, slug, title, description, category, start_date, end_date, image_url, active, closed, raw_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        description = excluded.description,
        category = excluded.category,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        image_url = excluded.image_url,
        active = excluded.active,
        closed = excluded.closed,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    // SQLite requires null instead of undefined
    stmt.run(
      event.id,
      event.slug ?? null,
      event.title,
      event.description ?? null,
      event.category ?? null,
      event.start_date ?? null,
      event.end_date ?? null,
      event.image_url ?? null,
      event.active ? 1 : 0,
      event.closed ? 1 : 0,
      event.raw_data ?? null
    );
  }

  getEvents(params: {
    active?: boolean;
    closed?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = "SELECT * FROM pm_events WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (params.active !== undefined) {
      query += " AND active = ?";
      queryParams.push(params.active ? 1 : 0);
    }

    if (params.closed !== undefined) {
      query += " AND closed = ?";
      queryParams.push(params.closed ? 1 : 0);
    }

    if (params.category) {
      query += " AND category = ?";
      queryParams.push(params.category);
    }

    query += " ORDER BY updated_at DESC";

    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += " OFFSET ?";
      queryParams.push(params.offset);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...queryParams) as EventRow[];
  }

  getEventById(id: string) {
    const stmt = this.db.prepare("SELECT * FROM pm_events WHERE id = ?");
    return stmt.get(id) as EventRow | undefined;
  }

  getEventBySlug(slug: string) {
    const stmt = this.db.prepare("SELECT * FROM pm_events WHERE slug = ?");
    return stmt.get(slug) as EventRow | undefined;
  }

  // Get all unique categories with event counts
  getCategories(excludeClosed: boolean = true) {
    let query = `
      SELECT category, COUNT(*) as count
      FROM pm_events
      WHERE category IS NOT NULL AND category != ''
    `;
    if (excludeClosed) {
      query += " AND closed = 0";
    }
    query += " GROUP BY category ORDER BY count DESC";

    const stmt = this.db.prepare(query);
    return stmt.all() as { category: string; count: number }[];
  }

  // Search events by title or description
  searchEvents(params: {
    query: string;
    closed?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    const searchTerm = `%${params.query}%`;
    let sql = `
      SELECT * FROM pm_events
      WHERE (title LIKE ? OR description LIKE ?)
    `;
    const queryParams: (string | number)[] = [searchTerm, searchTerm];

    if (params.closed !== undefined) {
      sql += " AND closed = ?";
      queryParams.push(params.closed ? 1 : 0);
    }

    if (params.category) {
      sql += " AND category = ?";
      queryParams.push(params.category);
    }

    sql += " ORDER BY updated_at DESC";

    if (params.limit) {
      sql += " LIMIT ?";
      queryParams.push(params.limit);
    }

    if (params.offset) {
      sql += " OFFSET ?";
      queryParams.push(params.offset);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...queryParams) as EventRow[];
  }

  // Search markets by question
  searchMarkets(params: {
    query: string;
    closed?: boolean;
    eventId?: string;
    limit?: number;
    offset?: number;
  }) {
    const searchTerm = `%${params.query}%`;
    let sql = "SELECT * FROM pm_markets WHERE question LIKE ?";
    const queryParams: (string | number)[] = [searchTerm];

    if (params.closed !== undefined) {
      sql += " AND closed = ?";
      queryParams.push(params.closed ? 1 : 0);
    }

    if (params.eventId) {
      sql += " AND event_id = ?";
      queryParams.push(params.eventId);
    }

    sql += " ORDER BY updated_at DESC";

    if (params.limit) {
      sql += " LIMIT ?";
      queryParams.push(params.limit);
    }

    if (params.offset) {
      sql += " OFFSET ?";
      queryParams.push(params.offset);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...queryParams) as MarketRow[];
  }

  // ==================== MARKETS ====================

  upsertMarket(market: MarketRow) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_markets (id, event_id, question, slug, outcomes, outcome_prices, token_ids, active, closed, volume, liquidity, raw_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        question = excluded.question,
        slug = excluded.slug,
        outcomes = excluded.outcomes,
        outcome_prices = excluded.outcome_prices,
        token_ids = excluded.token_ids,
        active = excluded.active,
        closed = excluded.closed,
        volume = excluded.volume,
        liquidity = excluded.liquidity,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    // SQLite requires null instead of undefined
    stmt.run(
      market.id,
      market.event_id ?? null,
      market.question,
      market.slug ?? null,
      market.outcomes ?? null,
      market.outcome_prices ?? null,
      market.token_ids ?? null,
      market.active ? 1 : 0,
      market.closed ? 1 : 0,
      market.volume ?? null,
      market.liquidity ?? null,
      market.raw_data ?? null
    );
  }

  getMarkets(params: {
    eventId?: string;
    active?: boolean;
    closed?: boolean;
    limit?: number;
    offset?: number;
  }) {
    let query = "SELECT * FROM pm_markets WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (params.eventId) {
      query += " AND event_id = ?";
      queryParams.push(params.eventId);
    }

    if (params.active !== undefined) {
      query += " AND active = ?";
      queryParams.push(params.active ? 1 : 0);
    }

    if (params.closed !== undefined) {
      query += " AND closed = ?";
      queryParams.push(params.closed ? 1 : 0);
    }

    query += " ORDER BY updated_at DESC";

    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += " OFFSET ?";
      queryParams.push(params.offset);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...queryParams) as MarketRow[];
  }

  getMarketById(id: string) {
    const stmt = this.db.prepare("SELECT * FROM pm_markets WHERE id = ?");
    return stmt.get(id) as MarketRow | undefined;
  }

  getMarketBySlug(slug: string) {
    const stmt = this.db.prepare("SELECT * FROM pm_markets WHERE slug = ?");
    return stmt.get(slug) as MarketRow | undefined;
  }

  getMarketsByEventId(eventId: string, excludeClosed: boolean = true) {
    let query = "SELECT * FROM pm_markets WHERE event_id = ?";
    if (excludeClosed) {
      query += " AND closed = 0";
    }
    query += " ORDER BY updated_at DESC";
    const stmt = this.db.prepare(query);
    return stmt.all(eventId) as MarketRow[];
  }

  // ==================== CANDLES ====================

  upsertCandle(candle: CandleRow) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_price_candles (token_id, timestamp, interval, open, high, low, close, volume, trade_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_id, timestamp, interval) DO UPDATE SET
        open = COALESCE(pm_price_candles.open, excluded.open),
        high = MAX(COALESCE(pm_price_candles.high, 0), excluded.high),
        low = CASE
          WHEN pm_price_candles.low IS NULL THEN excluded.low
          WHEN excluded.low IS NULL THEN pm_price_candles.low
          ELSE MIN(pm_price_candles.low, excluded.low)
        END,
        close = excluded.close,
        volume = COALESCE(pm_price_candles.volume, 0) + COALESCE(excluded.volume, 0),
        trade_count = COALESCE(pm_price_candles.trade_count, 0) + COALESCE(excluded.trade_count, 0)
    `);

    stmt.run(
      candle.token_id,
      candle.timestamp,
      candle.interval,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.trade_count
    );
  }

  getCandles(params: {
    tokenId: string;
    interval: CandleInterval;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) {
    let query =
      "SELECT * FROM pm_price_candles WHERE token_id = ? AND interval = ?";
    const queryParams: (string | number)[] = [params.tokenId, params.interval];

    if (params.startTime !== undefined) {
      query += " AND timestamp >= ?";
      queryParams.push(params.startTime);
    }

    if (params.endTime !== undefined) {
      query += " AND timestamp <= ?";
      queryParams.push(params.endTime);
    }

    query += " ORDER BY timestamp ASC";

    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...queryParams) as CandleRow[];
  }

  getLatestCandle(tokenId: string, interval: CandleInterval) {
    const stmt = this.db.prepare(`
      SELECT * FROM pm_price_candles
      WHERE token_id = ? AND interval = ?
      ORDER BY timestamp DESC LIMIT 1
    `);
    return stmt.get(tokenId, interval) as CandleRow | undefined;
  }

  // Get candles for aggregation (used to build larger timeframes)
  getCandlesForAggregation(
    tokenId: string,
    sourceInterval: CandleInterval,
    startTime: number,
    endTime: number
  ) {
    const stmt = this.db.prepare(`
      SELECT * FROM pm_price_candles
      WHERE token_id = ? AND interval = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(tokenId, sourceInterval, startTime, endTime) as CandleRow[];
  }

  // ==================== TRADES ====================

  insertTrade(trade: TradeRow) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO pm_trades (id, token_id, price, size, side, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trade.id,
      trade.token_id,
      trade.price,
      trade.size,
      trade.side,
      trade.timestamp
    );
  }

  getTrades(params: {
    tokenId: string;
    limit?: number;
    before?: number;
  }) {
    let query = "SELECT * FROM pm_trades WHERE token_id = ?";
    const queryParams: (string | number)[] = [params.tokenId];

    if (params.before !== undefined) {
      query += " AND timestamp < ?";
      queryParams.push(params.before);
    }

    query += " ORDER BY timestamp DESC";

    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...queryParams) as TradeRow[];
  }

  getTradesInRange(tokenId: string, startTime: number, endTime: number) {
    const stmt = this.db.prepare(`
      SELECT * FROM pm_trades
      WHERE token_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(tokenId, startTime, endTime) as TradeRow[];
  }

  // ==================== ORDERBOOK SNAPSHOTS ====================

  insertOrderbookSnapshot(snapshot: OrderbookSnapshotRow) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_orderbook_snapshots (token_id, timestamp, bids, asks)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      snapshot.token_id,
      snapshot.timestamp,
      snapshot.bids,
      snapshot.asks
    );
  }

  getLatestOrderbookSnapshot(tokenId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM pm_orderbook_snapshots
      WHERE token_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `);
    return stmt.get(tokenId) as OrderbookSnapshotRow | undefined;
  }

  // ==================== SYNC STATE ====================

  getSyncState(key: string): string | null {
    const stmt = this.db.prepare(
      "SELECT value FROM pm_sync_state WHERE key = ?"
    );
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSyncState(key: string, value: string) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_sync_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, value);
  }

  // ==================== PRICE HISTORY ====================

  // Batch insert price history points
  insertPriceHistoryPoints(points: PriceHistoryPointRow[]) {
    if (points.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO pm_price_history (token_id, timestamp, price, source)
      VALUES (?, ?, ?, ?)
    `);

    for (const point of points) {
      stmt.run(point.token_id, point.timestamp, point.price, point.source || "api");
    }
  }

  // Append a single real-time price update
  appendPriceHistoryPoint(tokenId: string, timestamp: number, price: number, source: string = "ws") {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pm_price_history (token_id, timestamp, price, source)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(tokenId, timestamp, price, source);
  }

  // Get price history for a range
  getPriceHistory(params: {
    tokenId: string;
    startTs: number;
    endTs: number;
    limit?: number;
  }): PriceHistoryPointRow[] {
    let query = `
      SELECT * FROM pm_price_history
      WHERE token_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `;
    const queryParams: (string | number)[] = [params.tokenId, params.startTs, params.endTs];

    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...queryParams) as PriceHistoryPointRow[];
  }

  // Get cached ranges for a token
  getCachedRanges(tokenId: string, interval: string): PriceHistoryRangeRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM pm_price_history_ranges
      WHERE token_id = ? AND interval = ?
      ORDER BY start_ts ASC
    `);
    return stmt.all(tokenId, interval) as PriceHistoryRangeRow[];
  }

  // Record a fetched range
  recordFetchedRange(range: Omit<PriceHistoryRangeRow, "id" | "fetched_at">) {
    const stmt = this.db.prepare(`
      INSERT INTO pm_price_history_ranges (token_id, start_ts, end_ts, interval, fidelity, point_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_id, start_ts, end_ts, interval) DO UPDATE SET
        point_count = excluded.point_count,
        fetched_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      range.token_id,
      range.start_ts,
      range.end_ts,
      range.interval,
      range.fidelity ?? null,
      range.point_count ?? 0
    );
  }

  // Find gaps in cached data for a requested range
  findUncachedRanges(
    tokenId: string,
    startTs: number,
    endTs: number,
    interval: string
  ): { startTs: number; endTs: number }[] {
    const cachedRanges = this.getCachedRanges(tokenId, interval);

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
  getPriceHistoryCount(tokenId: string): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM pm_price_history WHERE token_id = ?"
    );
    const result = stmt.get(tokenId) as { count: number };
    return result.count;
  }

  // ==================== UTILITIES ====================

  close() {
    this.db.close();
  }

  // Transaction wrapper
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN TRANSACTION");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
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
  active: number;
  closed: number;
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
  active: number;
  closed: number;
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

export function getPolymarketDB(): PolymarketDB {
  if (!dbInstance) {
    dbInstance = new PolymarketDB();
    dbInstance.bootstrapTables();
  }
  return dbInstance;
}
