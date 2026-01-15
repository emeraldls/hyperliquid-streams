// Polymarket WebSocket Client
// Connects to wss://ws-subscriptions-clob.polymarket.com/ws/

import WebSocket from "ws";
import { EventEmitter } from "events";
import { POLYMARKET_CONFIG } from "../config";
import { subscriptionManager } from "./subscription-manager";

export interface WsPriceChange {
  asset_id: string;
  price: string;
  side: string;
  timestamp: string;
}

export interface WsBookUpdate {
  asset_id: string;
  market: string;
  timestamp: string;
  hash: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

export interface WsTrade {
  id: string;
  asset_id: string;
  market: string;
  side: string; // "BUY" or "SELL"
  price: string;
  size: string;
  fee_rate_bps: string;
  match_time: string;
  outcome: string;
  taker_order_id: string;
  maker_address: string;
  owner: string;
  transaction_hash: string;
}

export interface WsBestBidAsk {
  asset_id: string;
  market: string;
  timestamp: string;
  best_bid: string;
  best_ask: string;
}

type WsMessageType = "price_change" | "book" | "trade" | "best_bid_ask";

interface WsMessage {
  type?: string;
  event_type?: string;
  asset_id?: string;
  [key: string]: unknown;
}

type PriceChangeMessage = {
  market: string;
  price_changes: {
    asset_id: string;
    price: string;
    size: string;
    side: "BUY" | "SELL";
    hash: string;
    best_bid: string;
    best_ask: string;
  }[];
};

export class PolymarketWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscribedTokens: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private auth = {
    apiKey: "5091e306-9203-e66a-e51a-5c14d72c26bd",
    secret: "JJljeecMHtkVmW0X4IH9fj-_Xjf-jpRaZ4Jpa3ZWlmI=",
    passphrase:
      "940bd5f622e534d1c925429d894aa83dd498a5247208d503b02f7ee29aff6942",
  };

  constructor() {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        // Wait for existing connection attempt
        this.once("connected", () => resolve());
        this.once("error", reject);
        return;
      }

      this.isConnecting = true;
      const wsUrl = POLYMARKET_CONFIG.urls.wss;

      console.log(`[PolymarketWS] Connecting to ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        console.log("[PolymarketWS] Connected");
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Start ping interval
        this.startPingInterval();

        // Re-subscribe to tokens if any
        if (this.subscribedTokens.size > 0) {
          console.log(
            `[PolymarketWS] Re-subscribing to ${this.subscribedTokens.size} tokens`
          );
          this.sendSubscription(Array.from(this.subscribedTokens));
        }

        this.emit("connected");
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on("close", (code, reason) => {
        console.log(
          `[PolymarketWS] Connection closed: ${code} - ${reason.toString()}`
        );
        this.isConnecting = false;
        this.stopPingInterval();
        this.emit("disconnected", { code, reason: reason.toString() });

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        console.error("[PolymarketWS] WebSocket error:", err);
        this.isConnecting = false;
        this.emit("error", err);

        // Only reject on initial connection
        if (this.reconnectAttempts === 0) {
          reject(err);
        }
      });
    });
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      // Convert to string first (handles Buffer, ArrayBuffer, string)
      const messageStr = data.toString();

      // Handle ping/pong or other non-JSON messages
      if (messageStr === "PONG" || messageStr === "pong") {
        console.log("[PolymarketWS] Received pong");
        return;
      }

      // Skip empty messages
      if (!messageStr || messageStr.trim() === "") {
        return;
      }

      // Only try to parse if it looks like JSON
      if (!messageStr.startsWith("{") && !messageStr.startsWith("[")) {
        console.log("[PolymarketWS] Received non-JSON message:", messageStr);
        return;
      }

      const message = JSON.parse(messageStr) as WsMessage;

      // Handle different message formats
      const eventType = message.event_type || message.type;

      if (!eventType) {
        // Might be a subscription confirmation or error
        if (message.error) {
          console.error("[PolymarketWS] Server error:", message.error);
        }
        return;
      }

      switch (eventType) {
        case "price_change":
          this.handlePriceChange(message as unknown as PriceChangeMessage);
          break;
        case "book":
          this.handleBookUpdate(message as unknown as WsBookUpdate);
          break;
        case "trade":
        case "last_trade_price":
          this.handleTrade(message as unknown as WsTrade);
          break;
        case "best_bid_ask":
          this.handleBestBidAsk(message as unknown as WsBestBidAsk);
          break;
        default:
          // Unknown message type - log for debugging
          console.log(`[PolymarketWS] Unknown message type: ${eventType}`);
      }
    } catch (err) {
      console.error("[PolymarketWS] Failed to parse message:", err);
    }
  }

  private handlePriceChange(data: PriceChangeMessage) {
    console.log(
      `[PolymarketWS] Price change for ${data.market}: ${data.price_changes.length} changes`
    );

    data.price_changes.forEach((change) => {
      const price = parseFloat(change.price);
      const timestamp = Date.now();

      subscriptionManager.handlePriceUpdate(change.asset_id, price, timestamp);
    });
  }

  private handleBookUpdate(data: WsBookUpdate) {
    console.log(
      `[PolymarketWS] Book update for ${data.asset_id}: ${data.bids?.length || 0} bids, ${data.asks?.length || 0} asks`
    );

    const bids = (data.bids || []).map((b) => [
      parseFloat(b.price),
      parseFloat(b.size),
    ]) as Array<[number, number]>;

    const asks = (data.asks || []).map((a) => [
      parseFloat(a.price),
      parseFloat(a.size),
    ]) as Array<[number, number]>;

    const timestamp = new Date(data.timestamp).getTime();

    subscriptionManager.handleOrderbookUpdate(
      data.asset_id,
      bids,
      asks,
      timestamp
    );
  }

  private handleTrade(data: WsTrade) {
    console.log(
      `[PolymarketWS] Trade for ${data.asset_id}: ${data.side} ${data.size} @ ${data.price}`
    );

    subscriptionManager.handleTradeUpdate({
      id: data.id,
      tokenId: data.asset_id,
      price: parseFloat(data.price),
      size: parseFloat(data.size),
      side: data.side,
      timestamp: new Date(data.match_time).getTime(),
    });
  }

  private handleBestBidAsk(data: WsBestBidAsk) {
    console.log(
      `[PolymarketWS] Best bid/ask for ${data.asset_id}: ${data.best_bid}/${data.best_ask}`
    );

    subscriptionManager.handleBestBidAskUpdate(
      data.asset_id,
      parseFloat(data.best_bid),
      parseFloat(data.best_ask),
      new Date(data.timestamp).getTime()
    );
  }

  subscribe(tokenIds: string[]) {
    const newTokens = tokenIds.filter((id) => !this.subscribedTokens.has(id));

    if (newTokens.length === 0) {
      console.log("[PolymarketWS] Already subscribed to all requested tokens");
      return;
    }

    // Add to tracked set
    newTokens.forEach((id) => this.subscribedTokens.add(id));

    // Send subscription if connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(newTokens);
    } else {
      console.log(
        "[PolymarketWS] Not connected, tokens queued for subscription"
      );
    }
  }

  unsubscribe(tokenIds: string[]) {
    const tokensToRemove = tokenIds.filter((id) =>
      this.subscribedTokens.has(id)
    );

    if (tokensToRemove.length === 0) {
      return;
    }

    // Remove from tracked set
    tokensToRemove.forEach((id) => this.subscribedTokens.delete(id));

    // Note: Polymarket WSS may not support unsubscribe
    // If needed, we may need to disconnect and reconnect with new subscription list
    console.log(
      `[PolymarketWS] Removed ${tokensToRemove.length} tokens from tracking`
    );
  }

  private sendSubscription(tokenIds: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[PolymarketWS] Cannot subscribe: not connected");
      return;
    }

    // Subscribe to market channel for these tokens
    // Note: Polymarket uses "assets_ids" (plural) in their API
    const subscribeMessage = {
      type: "market",
      assets_ids: tokenIds,
      auth: this.auth,
    };

    console.log(
      `[PolymarketWS] Subscribing to ${tokenIds.length} tokens:`,
      tokenIds.slice(0, 3).join(", "),
      tokenIds.length > 3 ? `... and ${tokenIds.length - 3} more` : ""
    );
    console.log(
      "[PolymarketWS] Sending subscription message:",
      JSON.stringify(subscribeMessage)
    );

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const maxAttempts = POLYMARKET_CONFIG.ws.reconnectMaxAttempts;

    if (this.reconnectAttempts >= maxAttempts) {
      console.error(
        `[PolymarketWS] Max reconnection attempts (${maxAttempts}) reached`
      );
      this.emit("max_reconnect_reached");
      return;
    }

    // Exponential backoff
    const baseDelay = POLYMARKET_CONFIG.ws.reconnectBaseDelay;
    const maxDelay = POLYMARKET_CONFIG.ws.reconnectMaxDelay;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts),
      maxDelay
    );

    this.reconnectAttempts++;

    console.log(
      `[PolymarketWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error("[PolymarketWS] Reconnection failed:", err);
      });
    }, delay);
  }

  private startPingInterval() {
    this.stopPingInterval();

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }
    }, POLYMARKET_CONFIG.ws.pingInterval);
  }

  private stopPingInterval() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect() {
    console.log("[PolymarketWS] Disconnecting...");

    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingInterval();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribedTokens.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscribedTokens(): string[] {
    return Array.from(this.subscribedTokens);
  }

  getStatus(): {
    connected: boolean;
    subscribedTokens: number;
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected(),
      subscribedTokens: this.subscribedTokens.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Event types emitted by the client
export interface PriceEvent {
  tokenId: string;
  price: number;
  side: string;
  timestamp: number;
}

export interface OrderbookEvent {
  tokenId: string;
  market: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
  hash: string;
}

export interface TradeEvent {
  id: string;
  tokenId: string;
  market: string;
  price: number;
  size: number;
  side: string;
  timestamp: number;
  outcome: string;
  maker: string;
  taker: string;
  txHash: string;
}

export interface BestBidAskEvent {
  tokenId: string;
  market: string;
  bestBid: number;
  bestAsk: number;
  timestamp: number;
}

// Singleton instance
let wsClientInstance: PolymarketWSClient | null = null;

export function getPolymarketWSClient(): PolymarketWSClient {
  if (!wsClientInstance) {
    wsClientInstance = new PolymarketWSClient();
  }
  return wsClientInstance;
}
