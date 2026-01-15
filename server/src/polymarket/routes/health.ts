// Health Check REST API Routes
// GET /api/pm/health - Get Polymarket subsystem status

import { Router, type Request, type Response } from "express";
import { getPolymarketDB } from "../db";
import { getPolymarketWSClient } from "../ws/client";
import { getWSServerStatus } from "../ws/server";
import { getSyncStatus } from "../services/sync";

const router = Router();

// GET /api/pm/health - Get Polymarket subsystem status
router.get("/", async (_req: Request, res: Response) => {
  try {
    const db = await getPolymarketDB();
    const pmWsClient = getPolymarketWSClient();
    const wsServerStatus = getWSServerStatus();
    const syncStatus = await getSyncStatus();

    // Get database stats
    const events = await db.getEvents({ limit: 1 });
    const markets = await db.getMarkets({ limit: 1 });

    // Count total events and markets
    const allEvents = await db.getEvents({});
    const allMarkets = await db.getMarkets({});
    const eventCount = allEvents.length;
    const marketCount = allMarkets.length;

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      polymarketWebSocket: {
        connected: pmWsClient.isConnected(),
        subscribedTokens: pmWsClient.getSubscribedTokens().length,
        reconnectAttempts: pmWsClient.getStatus().reconnectAttempts,
      },
      clientWebSocket: {
        connectedClients: wsServerStatus.connectedClients,
        totalSubscriptions: wsServerStatus.totalSubscriptions,
        uniqueTokens: wsServerStatus.uniqueTokens,
      },
      sync: {
        eventsLastSync: syncStatus.eventsLastSync,
        marketsLastSync: syncStatus.marketsLastSync,
        isCurrentlySyncing: syncStatus.isCurrentlySyncing,
      },
      database: {
        eventCount,
        marketCount,
        hasEvents: events.length > 0,
        hasMarkets: markets.length > 0,
      },
    });
  } catch (err) {
    console.error("[HealthAPI] Health check failed:", err);
    res.status(500).json({
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
