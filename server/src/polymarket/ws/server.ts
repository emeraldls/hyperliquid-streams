// WebSocket Server for Frontend Clients
// Manages client connections and broadcasts Polymarket updates

import WebSocket, { WebSocketServer } from "ws";
import { getPolymarketWSClient } from "./client";
import { getPolymarketDB } from "../db";
import { subscriptionManager, type ClientConnection } from "./subscription-manager";

// In-memory orderbook cache for instant responses
const orderbookCache: Map<
  string,
  {
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    timestamp: number;
  }
> = new Map();

let wss: WebSocketServer | null = null;

// Message types sent to clients
export interface ClientPriceMessage {
  type: "price";
  tokenId: string;
  price: number;
  timestamp: number;
}

export interface ClientOrderbookMessage {
  type: "orderbook";
  tokenId: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
}

export interface ClientTradeMessage {
  type: "trade";
  tokenId: string;
  price: number;
  size: number;
  side: string;
  timestamp: number;
  id?: string;
}

export interface ClientErrorMessage {
  type: "error";
  message: string;
}

export interface ClientSubscribedMessage {
  type: "subscribed";
  tokenIds: string[];
}

export interface ClientUnsubscribedMessage {
  type: "unsubscribed";
  tokenIds: string[];
}

export interface ClientBestBidAskMessage {
  type: "best_bid_ask";
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  timestamp: number;
}

type ClientMessage =
  | ClientPriceMessage
  | ClientOrderbookMessage
  | ClientTradeMessage
  | ClientErrorMessage
  | ClientSubscribedMessage
  | ClientUnsubscribedMessage
  | ClientBestBidAskMessage;

// Initialize WebSocket server
export function initPolymarketWSServer(): WebSocketServer {
  console.log(`[PolymarketWSServer] Initializing...`);

  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", handleConnection);

  // Set up Polymarket WebSocket client listeners
  setupPolymarketListeners();

  console.log("[PolymarketWSServer] Server initialized");

  return wss;
}

// Handle new client connection
function handleConnection(ws: WebSocket) {
  console.log("[PolymarketWSServer] Client connected");

  const connection = subscriptionManager.registerClient(ws);

  ws.on("message", (data) => {
    handleClientMessage(connection, data);
  });

  ws.on("close", () => {
    handleClientDisconnect(ws);
  });

  ws.on("error", (err) => {
    console.error("[PolymarketWSServer] Client error:", err);
  });
}

// Handle messages from clients
function handleClientMessage(connection: ClientConnection, data: WebSocket.Data) {
  try {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "subscribe":
        handleSubscribe(connection.ws, message.tokenIds || []);
        break;

      case "unsubscribe":
        handleUnsubscribe(connection.ws, message.tokenIds || []);
        break;

      case "get_orderbook":
        handleGetOrderbook(connection.ws, message.tokenId);
        break;

      default:
        sendToClient(connection.ws, {
          type: "error",
          message: `Unknown message type: ${message.type}`,
        });
    }
  } catch (err) {
    console.error("[PolymarketWSServer] Failed to parse client message:", err);
    sendToClient(connection.ws, {
      type: "error",
      message: "Invalid message format",
    });
  }
}

// Handle subscribe request
function handleSubscribe(ws: WebSocket, tokenIds: string[]) {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    sendToClient(ws, {
      type: "error",
      message: "tokenIds must be a non-empty array",
    });
    return;
  }

  const newSubscriptions = subscriptionManager.subscribe(ws, tokenIds);

  for (const tokenId of newSubscriptions) {
    // Check if we need to subscribe to the upstream Polymarket WS
    // (Only if this is the first subscriber globally for this token)
    if (subscriptionManager.getSubscriberCount(tokenId) === 1) {
      console.log(
        `[PolymarketWSServer] First subscriber for token ${tokenId}, subscribing to Polymarket`
      );
      const pmClient = getPolymarketWSClient();

      // Ensure we're connected before subscribing
      if (!pmClient.isConnected()) {
        console.log("[PolymarketWSServer] Polymarket WS not connected, connecting first...");
        pmClient.connect().then(() => {
          console.log("[PolymarketWSServer] Connected, now subscribing to token");
          pmClient.subscribe([tokenId]);
        }).catch((err) => {
          console.error("[PolymarketWSServer] Failed to connect to Polymarket:", err);
        });
      } else {
        pmClient.subscribe([tokenId]);
      }
    }
  }

  if (newSubscriptions.length > 0) {
    console.log(
      `[PolymarketWSServer] Client subscribed to ${newSubscriptions.length} tokens`
    );

    sendToClient(ws, {
      type: "subscribed",
      tokenIds: newSubscriptions,
    });

    // Send cached orderbook if available
    for (const tokenId of newSubscriptions) {
      const cached = orderbookCache.get(tokenId);
      if (cached) {
        sendToClient(ws, {
          type: "orderbook",
          tokenId,
          bids: cached.bids,
          asks: cached.asks,
          timestamp: cached.timestamp,
        });
      }
    }
  }
}

// Handle unsubscribe request
function handleUnsubscribe(ws: WebSocket, tokenIds: string[]) {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    return;
  }

  const unsubscribed = subscriptionManager.unsubscribe(ws, tokenIds);

  if (unsubscribed.length > 0) {
    console.log(
      `[PolymarketWSServer] Client unsubscribed from ${unsubscribed.length} tokens`
    );

    sendToClient(ws, {
      type: "unsubscribed",
      tokenIds: unsubscribed,
    });
  }
}

// Handle get_orderbook request
function handleGetOrderbook(ws: WebSocket, tokenId: string) {
  if (!tokenId) {
    sendToClient(ws, {
      type: "error",
      message: "tokenId is required",
    });
    return;
  }

  // Check cache first
  const cached = orderbookCache.get(tokenId);
  if (cached) {
    sendToClient(ws, {
      type: "orderbook",
      tokenId,
      bids: cached.bids,
      asks: cached.asks,
      timestamp: cached.timestamp,
    });
    return;
  }

  // Try to get from database
  const db = getPolymarketDB();
  const snapshot = db.getLatestOrderbookSnapshot(tokenId);

  if (snapshot) {
    try {
      const bids = JSON.parse(snapshot.bids || "[]");
      const asks = JSON.parse(snapshot.asks || "[]");

      sendToClient(ws, {
        type: "orderbook",
        tokenId,
        bids,
        asks,
        timestamp: snapshot.timestamp,
      });
    } catch {
      sendToClient(ws, {
        type: "error",
        message: "Failed to parse orderbook data",
      });
    }
  } else {
    sendToClient(ws, {
      type: "error",
      message: `No orderbook data available for ${tokenId}`,
    });
  }
}

// Handle client disconnect
function handleClientDisconnect(ws: WebSocket) {
  const connection = subscriptionManager.getConnection(ws);
  if (connection) {
    console.log(
      `[PolymarketWSServer] Client disconnected (was subscribed to ${connection.subscribedTokens.size} tokens)`
    );
    subscriptionManager.unregisterClient(ws);
  }
}

// Set up listeners for Polymarket WebSocket events
function setupPolymarketListeners() {
  const pmClient = getPolymarketWSClient();

  // Note: Market data events (price, orderbook, trade, best_bid_ask) 
  // are now handled directly by SubscriptionManager called from PolymarketWSClient.
  // We only listen for connection events here if needed.
  
  pmClient.on("error", (err) => {
    console.error("[PolymarketWSServer] Polymarket WS Client error:", err);
  });

  console.log("[PolymarketWSServer] Polymarket event listeners set up");
}

// Send message to a specific client
function sendToClient(ws: WebSocket, message: ClientMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Get server status
export function getWSServerStatus(): {
  connectedClients: number;
  totalSubscriptions: number;
  uniqueTokens: number;
} {
  let totalSubscriptions = 0;

  for (const connection of subscriptionManager.getAllConnections()) {
    totalSubscriptions += connection.subscribedTokens.size;
  }

  return {
    connectedClients: subscriptionManager.getConnectionCount(),
    totalSubscriptions,
    uniqueTokens: subscriptionManager.getUniqueTokenCount(),
  };
}

// Get cached orderbook
export function getCachedOrderbook(tokenId: string) {
  return orderbookCache.get(tokenId);
}

// Shutdown server
export function shutdownWSServer() {
  console.log("[PolymarketWSServer] Shutting down...");

  for (const connection of subscriptionManager.getAllConnections()) {
    connection.ws.close();
  }

  subscriptionManager.clear();
  orderbookCache.clear();

  if (wss) {
    wss.close();
    wss = null;
  }
}
