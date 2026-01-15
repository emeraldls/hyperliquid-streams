// Events REST API Routes
// GET /api/pm/events - List events
// GET /api/pm/events/categories - Get all categories
// GET /api/pm/events/search - Search events and markets
// GET /api/pm/events/:id - Get single event with markets

import { Router, type Request, type Response } from "express";
import { getPolymarketDB } from "../db";
import { POLYMARKET_CONFIG } from "../config";

const router = Router();

// GET /api/pm/events/categories - Get all categories
router.get("/categories", (req: Request, res: Response) => {
  const db = getPolymarketDB();

  try {
    const categories = db.getCategories();

    res.json({
      data: categories.map((c) => ({
        name: c.category,
        count: c.count,
      })),
      total: categories.length,
    });
  } catch (err) {
    console.error("[EventsAPI] Failed to get categories:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// GET /api/pm/events/search - Search events and markets
router.get("/search", (req: Request, res: Response) => {
  const db = getPolymarketDB();

  const query = req.query.q as string | undefined;
  const category = req.query.category as string | undefined;
  const closedParam = req.query.closed as string | undefined;
  const limitParam = req.query.limit as string | undefined;
  const offsetParam = req.query.offset as string | undefined;

  if (!query || query.trim().length === 0) {
    res.status(400).json({ error: "Search query 'q' is required" });
    return;
  }

  const limit = Math.min(
    parseInt(limitParam || String(POLYMARKET_CONFIG.pagination.defaultLimit), 10),
    POLYMARKET_CONFIG.pagination.maxLimit
  );
  const offset = parseInt(offsetParam || "0", 10);

  // Default to excluding closed unless explicitly requested
  const closed = closedParam !== undefined
    ? closedParam === "true" || closedParam === "1"
    : false;

  try {
    // Search events
    const events = db.searchEvents({
      query: query.trim(),
      closed,
      category,
      limit,
      offset,
    });

    // Search markets
    const markets = db.searchMarkets({
      query: query.trim(),
      closed,
      limit,
      offset,
    });

    // Parse events
    const parsedEvents = events.map((event) => {
      let fullData = null;
      try {
        if (event.raw_data) {
          fullData = JSON.parse(event.raw_data);
        }
      } catch {
        // Ignore parse errors
      }

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        category: event.category,
        imageUrl: event.image_url,
        active: Boolean(event.active),
        closed: Boolean(event.closed),
        liquidity: fullData?.liquidity,
        volume: fullData?.volume,
      };
    });

    // Parse markets
    const parsedMarkets = markets.map((market) => {
      let tokenIds: string[] = [];
      try {
        if (market.token_ids) tokenIds = JSON.parse(market.token_ids);
      } catch {
        // Ignore parse errors
      }

      return {
        id: market.id,
        eventId: market.event_id,
        question: market.question,
        slug: market.slug,
        tokenIds,
        active: Boolean(market.active),
        closed: Boolean(market.closed),
        volume: market.volume,
        liquidity: market.liquidity,
      };
    });

    res.json({
      query: query.trim(),
      events: {
        data: parsedEvents,
        count: parsedEvents.length,
      },
      markets: {
        data: parsedMarkets,
        count: parsedMarkets.length,
      },
    });
  } catch (err) {
    console.error("[EventsAPI] Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /api/pm/events - List events
router.get("/", (req: Request, res: Response) => {
  const db = getPolymarketDB();

  // Parse query parameters
  const activeParam = req.query.active as string | undefined;
  const closedParam = req.query.closed as string | undefined;
  const category = req.query.category as string | undefined;
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
    category?: string;
    limit?: number;
    offset?: number;
  } = {
    limit,
    offset,
  };

  if (activeParam !== undefined) {
    params.active = activeParam === "true" || activeParam === "1";
  }

  // Default to closed: false (only return open events) unless explicitly requested
  if (closedParam !== undefined) {
    params.closed = closedParam === "true" || closedParam === "1";
  } else {
    // Default: exclude closed events
    params.closed = false;
  }

  if (category) {
    params.category = category;
  }

  try {
    const events = db.getEvents(params);

    // Parse raw_data JSON for each event to get full details
    const parsedEvents = events.map((event) => {
      let fullData = null;
      try {
        if (event.raw_data) {
          fullData = JSON.parse(event.raw_data);
        }
      } catch {
        // Ignore parse errors
      }

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        category: event.category,
        startDate: event.start_date,
        endDate: event.end_date,
        imageUrl: event.image_url,
        active: Boolean(event.active),
        closed: Boolean(event.closed),
        createdAt: event.created_at,
        updatedAt: event.updated_at,
        // Include additional fields from raw_data if available
        liquidity: fullData?.liquidity,
        volume: fullData?.volume,
        tags: fullData?.tags || [],
      };
    });

    res.json({
      data: parsedEvents,
      pagination: {
        limit,
        offset,
        total: parsedEvents.length,
      },
    });
  } catch (err) {
    console.error("[EventsAPI] Failed to get events:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// GET /api/pm/events/:id - Get single event with markets
router.get("/:id", (req: Request, res: Response) => {
  const db = getPolymarketDB();
  const { id } = req.params;

  try {
    // Try by ID first, then by slug
    let event = db.getEventById(id);

    if (!event) {
      event = db.getEventBySlug(id);
    }

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    // Get markets for this event
    const markets = db.getMarketsByEventId(event.id);

    // Parse raw_data for full details
    let fullData = null;
    try {
      if (event.raw_data) {
        fullData = JSON.parse(event.raw_data);
      }
    } catch {
      // Ignore parse errors
    }

    // Parse markets
    const parsedMarkets = markets.map((market) => {
      let marketFullData = null;
      try {
        if (market.raw_data) {
          marketFullData = JSON.parse(market.raw_data);
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
        bestBid: marketFullData?.bestBid,
        bestAsk: marketFullData?.bestAsk,
        lastTradePrice: marketFullData?.lastTradePrice,
        spread: marketFullData?.spread,
        oneDayPriceChange: marketFullData?.oneDayPriceChange,
      };
    });

    res.json({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      category: event.category,
      startDate: event.start_date,
      endDate: event.end_date,
      imageUrl: event.image_url,
      active: Boolean(event.active),
      closed: Boolean(event.closed),
      createdAt: event.created_at,
      updatedAt: event.updated_at,
      // Additional fields from raw_data
      liquidity: fullData?.liquidity,
      volume: fullData?.volume,
      tags: fullData?.tags || [],
      // Include markets
      markets: parsedMarkets,
    });
  } catch (err) {
    console.error("[EventsAPI] Failed to get event:", err);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

export default router;
