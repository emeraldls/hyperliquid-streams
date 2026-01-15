// Polymarket Module Entry Point
// Initializes database, sync jobs, WebSocket connections, and exports router

import type { Server as HTTPServer } from "http";
import type { WebSocketServer } from "ws";
import { getPolymarketDB } from "./db";
import { getPolymarketWSClient } from "./ws/client";
import { initPolymarketWSServer, shutdownWSServer } from "./ws/server";
import { startSyncJobs, stopSyncJobs } from "./services/sync";
import polymarketRouter from "./routes";

// Export router for Express integration
export { polymarketRouter };

// Export types
export * from "./config";

export let polymarketWss: WebSocketServer | null = null;

// Initialize Polymarket module
export async function initPolymarket(): Promise<void> {
  console.log("[Polymarket] Initializing Polymarket module...");

  // 1. Initialize database
  console.log("[Polymarket] Setting up database...");
  await getPolymarketDB();

  // 2. Initialize WebSocket client (connection to Polymarket)
  console.log("[Polymarket] Connecting to Polymarket WebSocket...");
  const wsClient = getPolymarketWSClient();

  // Attach error listener to prevent unhandled 'error' events
  wsClient.on("error", (err) => {
    console.error("[Polymarket] WS Client error:", err.message);
  });

  try {
    await wsClient.connect();
    console.log("[Polymarket] Connected to Polymarket WebSocket");
  } catch (err) {
    console.error(
      "[Polymarket] Failed to connect to Polymarket WebSocket:",
      err
    );
    console.log("[Polymarket] Will retry connection in background");
  }

  // 3. Initialize WebSocket server for frontend clients
  console.log("[Polymarket] Setting up WebSocket server for clients...");
  polymarketWss = initPolymarketWSServer();

  // 4. Start background sync jobs
  console.log("[Polymarket] Starting background sync jobs...");
  startSyncJobs();

  console.log("[Polymarket] Polymarket module initialized successfully");
}

// Shutdown Polymarket module
export async function shutdownPolymarket(): Promise<void> {
  console.log("[Polymarket] Shutting down Polymarket module...");

  // Stop sync jobs
  stopSyncJobs();

  // Disconnect WebSocket client
  const wsClient = getPolymarketWSClient();
  wsClient.disconnect();

  // Shutdown WebSocket server
  shutdownWSServer();

  // Close database
  const db = await getPolymarketDB();
  await db.close();

  console.log("[Polymarket] Polymarket module shut down");
}

// Graceful shutdown handler
export function setupGracefulShutdown(): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`[Polymarket] Received ${signal}, shutting down...`);
      await shutdownPolymarket();
      process.exit(0);
    });
  }
}
