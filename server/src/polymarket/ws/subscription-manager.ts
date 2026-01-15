import WebSocket from "ws";
import { appendRealtimePrice } from "../services/timeseries";
import { handleRealtimeTrade } from "../services/candles";
import { getPolymarketDB } from "../db";

export interface ClientConnection {
  ws: WebSocket;
  subscribedTokens: Set<string>;
  connectedAt: number;
}

export class SubscriptionManager {
  private clients: Map<WebSocket, ClientConnection> = new Map();
  private tokenSubscriberCount: Map<string, number> = new Map();

  // Singleton instance
  private static instance: SubscriptionManager | null = null;

  public static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager();
    }
    return SubscriptionManager.instance;
  }

  /**
   * Register a new client connection
   */
  registerClient(ws: WebSocket): ClientConnection {
    const connection: ClientConnection = {
      ws,
      subscribedTokens: new Set(),
      connectedAt: Date.now(),
    };
    this.clients.set(ws, connection);
    return connection;
  }

  /**
   * Unregister a client connection and clean up its subscriptions
   */
  unregisterClient(ws: WebSocket): void {
    const connection = this.clients.get(ws);
    if (connection) {
      for (const tokenId of connection.subscribedTokens) {
        this.decrementSubscriberCount(tokenId);
      }
      this.clients.delete(ws);
    }
  }

  /**
   * Add subscriptions for a client
   * @returns List of token IDs that are actually new subscriptions for this client
   */
  subscribe(ws: WebSocket, tokenIds: string[]): string[] {
    const connection = this.clients.get(ws);
    if (!connection) return [];

    const newSubs: string[] = [];
    for (const tokenId of tokenIds) {
      if (!connection.subscribedTokens.has(tokenId)) {
        connection.subscribedTokens.add(tokenId);
        newSubs.push(tokenId);
        this.incrementSubscriberCount(tokenId);
      }
    }
    return newSubs;
  }

  /**
   * Remove subscriptions for a client
   * @returns List of token IDs that were actually removed
   */
  unsubscribe(ws: WebSocket, tokenIds: string[]): string[] {
    const connection = this.clients.get(ws);
    if (!connection) return [];

    const removed: string[] = [];
    for (const tokenId of tokenIds) {
      if (connection.subscribedTokens.has(tokenId)) {
        connection.subscribedTokens.delete(tokenId);
        removed.push(tokenId);
        this.decrementSubscriberCount(tokenId);
      }
    }
    return removed;
  }

  private incrementSubscriberCount(tokenId: string): void {
    const count = this.tokenSubscriberCount.get(tokenId) || 0;
    this.tokenSubscriberCount.set(tokenId, count + 1);
  }

  private decrementSubscriberCount(tokenId: string): void {
    const count = this.tokenSubscriberCount.get(tokenId) || 0;
    if (count > 1) {
      this.tokenSubscriberCount.set(tokenId, count - 1);
    } else {
      this.tokenSubscriberCount.delete(tokenId);
    }
  }

  /**
   * Broadcast a message to all clients subscribed to a specific token
   */
  broadcast(tokenId: string, message: any): void {
    const payload = JSON.stringify(message);
    let count = 0;

    for (const connection of this.clients.values()) {
      if (
        connection.subscribedTokens.has(tokenId) &&
        connection.ws.readyState === WebSocket.OPEN
      ) {
        connection.ws.send(payload);
        count++;
      }
    }

    if (count > 0) {
      console.log(
        `[SubscriptionManager] Broadcast ${message.type} for ${tokenId} to ${count} clients`
      );
    }
  }

  /**
   * Get the number of active subscribers for a specific token
   */
  getSubscriberCount(tokenId: string): number {
    return this.tokenSubscriberCount.get(tokenId) || 0;
  }

  /**
   * Get connection metadata for a specific WebSocket
   */
  getConnection(ws: WebSocket): ClientConnection | undefined {
    return this.clients.get(ws);
  }

  /**
   * Get all active connections
   */
  getAllConnections(): IterableIterator<ClientConnection> {
    return this.clients.values();
  }

  /**
   * Get total number of active connections
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get total number of unique tokens with at least one subscriber
   */
  getUniqueTokenCount(): number {
    return this.tokenSubscriberCount.size;
  }

  /**
   * Clear all connections (used for shutdown)
   */
  clear(): void {
    this.clients.clear();
    this.tokenSubscriberCount.clear();
  }

  // --- Upstream Data Handling (Multiplexing & Side Effects) ---

  async handlePriceUpdate(tokenId: string, price: number, timestamp: number): Promise<void> {
    // 1. Side effect: Store in timeseries
    await appendRealtimePrice(tokenId, Math.floor(timestamp / 1000), price);

    // 2. Broadcast to users
    this.broadcast(tokenId, {
      type: "price",
      tokenId,
      price,
      timestamp,
    });
  }

  async handleOrderbookUpdate(tokenId: string, bids: Array<[number, number]>, asks: Array<[number, number]>, timestamp: number): Promise<void> {
    // 1. Side effect: Store in DB
    const db = await getPolymarketDB();
    await db.insertOrderbookSnapshot({
      token_id: tokenId,
      timestamp,
      bids: JSON.stringify(bids),
      asks: JSON.stringify(asks),
    });

    // 2. Broadcast to users
    this.broadcast(tokenId, {
      type: "orderbook",
      tokenId,
      bids,
      asks,
      timestamp,
    });
  }

  async handleTradeUpdate(data: {
    id: string;
    tokenId: string;
    price: number;
    size: number;
    side: string;
    timestamp: number;
  }): Promise<void> {
    // 1. Side effect: Process into candles
    await handleRealtimeTrade({
      tokenId: data.tokenId,
      price: data.price,
      size: data.size,
      side: data.side,
      timestamp: data.timestamp,
    });

    // 2. Broadcast to users
    this.broadcast(data.tokenId, {
      type: "trade",
      ...data,
    });
  }

  handleBestBidAskUpdate(tokenId: string, bestBid: number, bestAsk: number, timestamp: number): void {
    // 1. Broadcast to users
    this.broadcast(tokenId, {
      type: "best_bid_ask",
      tokenId,
      bestBid,
      bestAsk,
      timestamp,
    });
  }
}

export const subscriptionManager = SubscriptionManager.getInstance();
