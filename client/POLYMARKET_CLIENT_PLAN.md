# Polymarket Client Implementation Plan

## Overview

This document outlines the client-side implementation for consuming the Polymarket backend APIs. The backend provides REST endpoints for querying market data and WebSocket connections for real-time updates.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  REST API   │  │  WebSocket  │  │       UI Components     │  │
│  │   Client    │  │   Client    │  │  - MarketList           │  │
│  │             │  │             │  │  - PriceChart           │  │
│  │             │  │             │  │  - OrderBook            │  │
│  │             │  │             │  │  - TradesFeed           │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                     │                 │
│         └────────────────┴─────────────────────┘                 │
│                          │                                       │
│                    ┌─────▼─────┐                                 │
│                    │   State   │  (React Query / Zustand / etc)  │
│                    │   Store   │                                 │
│                    └───────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │     Backend Server      │
              │   http://localhost:3002 │
              │   ws://localhost:3002   │
              └─────────────────────────┘
```

---

## API Reference

### Base URLs

```typescript
const API_BASE = "http://localhost:3002/api/pm";
const WS_URL = "ws://localhost:3002/ws/pm";
```

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | GET | List events with filtering |
| `/events/:id` | GET | Single event with markets |
| `/markets` | GET | List markets with filtering |
| `/markets/:id` | GET | Single market details |
| `/markets/:id/candles` | GET | OHLCV candle data |
| `/markets/:id/trades` | GET | Recent trades |
| `/markets/:id/orderbook` | GET | Current orderbook |
| `/health` | GET | System status |

---

## TypeScript Types

```typescript
// Event type
interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
  active: boolean;
  closed: boolean;
  liquidity?: number;
  volume?: number;
  tags?: Array<{ id: string; label: string; slug: string }>;
  markets?: Market[];
}

// Market type
interface Market {
  id: string;
  eventId: string | null;
  question: string;
  slug: string;
  outcomes: string[];           // e.g., ["Yes", "No"]
  outcomePrices: number[];      // e.g., [0.65, 0.35]
  tokenIds: string[];           // Token IDs for each outcome
  active: boolean;
  closed: boolean;
  volume: string;
  liquidity: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  oneDayPriceChange?: number;
}

// Candle (OHLCV) type
interface Candle {
  timestamp: number;    // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

// Trade type
interface Trade {
  id: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  timestamp: number;
}

// Orderbook type
interface Orderbook {
  marketId: string;
  tokenId: string;
  bids: [number, number][];  // [price, size][]
  asks: [number, number][];
  timestamp: number;
}

// WebSocket message types
interface WsPriceMessage {
  type: "price";
  tokenId: string;
  price: number;
  timestamp: number;
}

interface WsOrderbookMessage {
  type: "orderbook";
  tokenId: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

interface WsTradeMessage {
  type: "trade";
  tokenId: string;
  price: number;
  size: number;
  side: string;
  timestamp: number;
  id?: string;
}

interface WsSubscribedMessage {
  type: "subscribed";
  tokenIds: string[];
}

interface WsErrorMessage {
  type: "error";
  message: string;
}

type WsMessage =
  | WsPriceMessage
  | WsOrderbookMessage
  | WsTradeMessage
  | WsSubscribedMessage
  | WsErrorMessage;
```

---

## Implementation Steps

### Phase 1: API Client Setup

Create a base API client with typed methods.

**File: `src/lib/api/polymarket.ts`**

```typescript
const API_BASE = "http://localhost:3002/api/pm";

// Generic fetch wrapper
async function fetchAPI<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  return response.json();
}

// Events API
export async function getEvents(params?: {
  active?: boolean;
  category?: string;
  limit?: number;
  offset?: number;
}) {
  return fetchAPI<{ data: PolymarketEvent[]; pagination: any }>("/events", {
    active: params?.active?.toString(),
    category: params?.category,
    limit: params?.limit?.toString(),
    offset: params?.offset?.toString(),
  });
}

export async function getEvent(idOrSlug: string) {
  return fetchAPI<PolymarketEvent>(`/events/${idOrSlug}`);
}

// Markets API
export async function getMarkets(params?: {
  eventId?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}) {
  return fetchAPI<{ data: Market[]; pagination: any }>("/markets", {
    eventId: params?.eventId,
    active: params?.active?.toString(),
    limit: params?.limit?.toString(),
    offset: params?.offset?.toString(),
  });
}

export async function getMarket(idOrSlug: string) {
  return fetchAPI<Market>(`/markets/${idOrSlug}`);
}

// Candles API
export async function getCandles(
  marketId: string,
  params?: {
    interval?: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";
    startTime?: number;
    endTime?: number;
    limit?: number;
  }
) {
  return fetchAPI<{ marketId: string; tokenId: string; interval: string; data: Candle[] }>(
    `/markets/${marketId}/candles`,
    {
      interval: params?.interval || "1h",
      startTime: params?.startTime?.toString(),
      endTime: params?.endTime?.toString(),
      limit: params?.limit?.toString(),
    }
  );
}

// Trades API
export async function getTrades(marketId: string, params?: { limit?: number; before?: number }) {
  return fetchAPI<{ marketId: string; tokenId: string; data: Trade[] }>(
    `/markets/${marketId}/trades`,
    {
      limit: params?.limit?.toString(),
      before: params?.before?.toString(),
    }
  );
}

// Orderbook API
export async function getOrderbook(marketId: string) {
  return fetchAPI<Orderbook>(`/markets/${marketId}/orderbook`);
}

// Health API
export async function getHealth() {
  return fetchAPI<any>("/health");
}
```

---

### Phase 2: WebSocket Client

Create a WebSocket client for real-time updates.

**File: `src/lib/ws/polymarketWS.ts`**

```typescript
type MessageHandler = (message: WsMessage) => void;

class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private subscribedTokens: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string = "ws://localhost:3002/ws/pm") {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[PolymarketWS] Connected");
        this.reconnectAttempts = 0;

        // Re-subscribe to tokens
        if (this.subscribedTokens.size > 0) {
          this.send({
            type: "subscribe",
            tokenIds: Array.from(this.subscribedTokens),
          });
        }

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;
          this.handlers.forEach((handler) => handler(message));
        } catch (err) {
          console.error("[PolymarketWS] Failed to parse message:", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[PolymarketWS] Disconnected");
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[PolymarketWS] Error:", error);
        reject(error);
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[PolymarketWS] Max reconnection attempts reached");
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[PolymarketWS] Reconnecting in ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }

  private send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(tokenIds: string[]) {
    tokenIds.forEach((id) => this.subscribedTokens.add(id));
    this.send({ type: "subscribe", tokenIds });
  }

  unsubscribe(tokenIds: string[]) {
    tokenIds.forEach((id) => this.subscribedTokens.delete(id));
    this.send({ type: "unsubscribe", tokenIds });
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.subscribedTokens.clear();
  }
}

// Singleton instance
export const polymarketWS = new PolymarketWebSocket();
```

---

### Phase 3: React Hooks

Create React hooks for easy data fetching and real-time updates.

**File: `src/lib/hooks/usePolymarketEvents.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { getEvents, getEvent } from "../api/polymarket";

export function usePolymarketEvents(params?: {
  active?: boolean;
  category?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["polymarket", "events", params],
    queryFn: () => getEvents(params),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function usePolymarketEvent(idOrSlug: string) {
  return useQuery({
    queryKey: ["polymarket", "event", idOrSlug],
    queryFn: () => getEvent(idOrSlug),
    enabled: !!idOrSlug,
  });
}
```

**File: `src/lib/hooks/usePolymarketMarkets.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { getMarkets, getMarket, getCandles, getTrades, getOrderbook } from "../api/polymarket";

export function usePolymarketMarkets(params?: {
  eventId?: string;
  active?: boolean;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["polymarket", "markets", params],
    queryFn: () => getMarkets(params),
    staleTime: 60 * 1000,
  });
}

export function usePolymarketMarket(idOrSlug: string) {
  return useQuery({
    queryKey: ["polymarket", "market", idOrSlug],
    queryFn: () => getMarket(idOrSlug),
    enabled: !!idOrSlug,
  });
}

export function usePolymarketCandles(
  marketId: string,
  interval: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" = "1h"
) {
  return useQuery({
    queryKey: ["polymarket", "candles", marketId, interval],
    queryFn: () => getCandles(marketId, { interval }),
    enabled: !!marketId,
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

export function usePolymarketTrades(marketId: string, limit = 50) {
  return useQuery({
    queryKey: ["polymarket", "trades", marketId, limit],
    queryFn: () => getTrades(marketId, { limit }),
    enabled: !!marketId,
  });
}

export function usePolymarketOrderbook(marketId: string) {
  return useQuery({
    queryKey: ["polymarket", "orderbook", marketId],
    queryFn: () => getOrderbook(marketId),
    enabled: !!marketId,
    refetchInterval: 5000, // Refetch every 5 seconds as fallback
  });
}
```

**File: `src/lib/hooks/usePolymarketStream.ts`**

```typescript
import { useEffect, useState, useCallback } from "react";
import { polymarketWS } from "../ws/polymarketWS";

interface StreamState {
  prices: Map<string, { price: number; timestamp: number }>;
  orderbooks: Map<string, { bids: [number, number][]; asks: [number, number][]; timestamp: number }>;
  trades: Map<string, Array<{ price: number; size: number; side: string; timestamp: number }>>;
}

export function usePolymarketStream(tokenIds: string[]) {
  const [state, setState] = useState<StreamState>({
    prices: new Map(),
    orderbooks: new Map(),
    trades: new Map(),
  });
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to WebSocket
    polymarketWS.connect().then(() => {
      setIsConnected(true);
    });

    // Subscribe to tokens
    if (tokenIds.length > 0) {
      polymarketWS.subscribe(tokenIds);
    }

    // Handle messages
    const unsubscribe = polymarketWS.onMessage((message) => {
      setState((prev) => {
        const newState = { ...prev };

        switch (message.type) {
          case "price":
            newState.prices = new Map(prev.prices);
            newState.prices.set(message.tokenId, {
              price: message.price,
              timestamp: message.timestamp,
            });
            break;

          case "orderbook":
            newState.orderbooks = new Map(prev.orderbooks);
            newState.orderbooks.set(message.tokenId, {
              bids: message.bids,
              asks: message.asks,
              timestamp: message.timestamp,
            });
            break;

          case "trade":
            newState.trades = new Map(prev.trades);
            const existingTrades = prev.trades.get(message.tokenId) || [];
            newState.trades.set(message.tokenId, [
              {
                price: message.price,
                size: message.size,
                side: message.side,
                timestamp: message.timestamp,
              },
              ...existingTrades.slice(0, 99), // Keep last 100 trades
            ]);
            break;
        }

        return newState;
      });
    });

    return () => {
      unsubscribe();
      if (tokenIds.length > 0) {
        polymarketWS.unsubscribe(tokenIds);
      }
    };
  }, [tokenIds.join(",")]);

  return {
    isConnected,
    prices: state.prices,
    orderbooks: state.orderbooks,
    trades: state.trades,
  };
}

// Hook for single token stream
export function useTokenStream(tokenId: string) {
  const { prices, orderbooks, trades, isConnected } = usePolymarketStream(
    tokenId ? [tokenId] : []
  );

  return {
    isConnected,
    price: prices.get(tokenId),
    orderbook: orderbooks.get(tokenId),
    recentTrades: trades.get(tokenId) || [],
  };
}
```

---

### Phase 4: UI Components

#### Market List Component

**File: `src/components/polymarket/MarketList.tsx`**

```tsx
import { usePolymarketMarkets } from "@/lib/hooks/usePolymarketMarkets";

export function MarketList({ eventId }: { eventId?: string }) {
  const { data, isLoading, error } = usePolymarketMarkets({ eventId, active: true });

  if (isLoading) return <div>Loading markets...</div>;
  if (error) return <div>Error loading markets</div>;

  return (
    <div className="space-y-4">
      {data?.data.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const yesPrice = market.outcomePrices?.[0] ?? 0;
  const noPrice = market.outcomePrices?.[1] ?? 0;

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
      <h3 className="font-semibold text-lg">{market.question}</h3>

      <div className="flex gap-4 mt-3">
        <div className="flex-1 bg-green-50 rounded p-2 text-center">
          <div className="text-green-600 font-bold">{(yesPrice * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500">Yes</div>
        </div>
        <div className="flex-1 bg-red-50 rounded p-2 text-center">
          <div className="text-red-600 font-bold">{(noPrice * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500">No</div>
        </div>
      </div>

      <div className="flex justify-between text-sm text-gray-500 mt-3">
        <span>Volume: ${Number(market.volume).toLocaleString()}</span>
        <span>Liquidity: ${Number(market.liquidity).toLocaleString()}</span>
      </div>
    </div>
  );
}
```

#### Price Chart Component

**File: `src/components/polymarket/PriceChart.tsx`**

```tsx
import { usePolymarketCandles } from "@/lib/hooks/usePolymarketMarkets";
import { useState } from "react";

// Use your preferred charting library (lightweight-charts, recharts, etc.)
// This is a placeholder structure

type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export function PriceChart({ marketId }: { marketId: string }) {
  const [interval, setInterval] = useState<Interval>("1h");
  const { data, isLoading } = usePolymarketCandles(marketId, interval);

  const intervals: Interval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

  return (
    <div className="border rounded-lg p-4">
      <div className="flex gap-2 mb-4">
        {intervals.map((int) => (
          <button
            key={int}
            onClick={() => setInterval(int)}
            className={`px-3 py-1 rounded ${
              interval === int ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}
          >
            {int}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">Loading chart...</div>
      ) : (
        <div className="h-64">
          {/* Render your chart here with data?.data */}
          {/* Example with lightweight-charts or recharts */}
        </div>
      )}
    </div>
  );
}
```

#### Order Book Component

**File: `src/components/polymarket/OrderBook.tsx`**

```tsx
import { useTokenStream } from "@/lib/hooks/usePolymarketStream";
import { usePolymarketOrderbook } from "@/lib/hooks/usePolymarketMarkets";

export function OrderBook({ marketId, tokenId }: { marketId: string; tokenId: string }) {
  // Get initial orderbook from REST
  const { data: initialData } = usePolymarketOrderbook(marketId);

  // Get real-time updates from WebSocket
  const { orderbook: streamData, isConnected } = useTokenStream(tokenId);

  // Use stream data if available, otherwise initial data
  const orderbook = streamData || initialData;

  if (!orderbook) {
    return <div>Loading orderbook...</div>;
  }

  const maxSize = Math.max(
    ...orderbook.bids.map((b) => b[1]),
    ...orderbook.asks.map((a) => a[1])
  );

  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">Order Book</h3>
        <span className={`text-xs ${isConnected ? "text-green-500" : "text-red-500"}`}>
          {isConnected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Bids */}
        <div>
          <div className="text-sm text-gray-500 mb-2">Bids</div>
          {orderbook.bids.slice(0, 10).map(([price, size], i) => (
            <div key={i} className="relative">
              <div
                className="absolute inset-0 bg-green-100"
                style={{ width: `${(size / maxSize) * 100}%` }}
              />
              <div className="relative flex justify-between text-sm py-1 px-2">
                <span className="text-green-600">{(price * 100).toFixed(1)}%</span>
                <span>{size.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Asks */}
        <div>
          <div className="text-sm text-gray-500 mb-2">Asks</div>
          {orderbook.asks.slice(0, 10).map(([price, size], i) => (
            <div key={i} className="relative">
              <div
                className="absolute inset-0 bg-red-100 right-0"
                style={{ width: `${(size / maxSize) * 100}%` }}
              />
              <div className="relative flex justify-between text-sm py-1 px-2">
                <span className="text-red-600">{(price * 100).toFixed(1)}%</span>
                <span>{size.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

#### Trades Feed Component

**File: `src/components/polymarket/TradesFeed.tsx`**

```tsx
import { useTokenStream } from "@/lib/hooks/usePolymarketStream";
import { usePolymarketTrades } from "@/lib/hooks/usePolymarketMarkets";

export function TradesFeed({ marketId, tokenId }: { marketId: string; tokenId: string }) {
  // Get initial trades from REST
  const { data: initialData } = usePolymarketTrades(marketId);

  // Get real-time trades from WebSocket
  const { recentTrades, isConnected } = useTokenStream(tokenId);

  // Merge stream trades with initial data
  const trades = recentTrades.length > 0
    ? recentTrades
    : initialData?.data || [];

  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">Recent Trades</h3>
        <span className={`text-xs ${isConnected ? "text-green-500" : "text-red-500"}`}>
          {isConnected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {trades.map((trade, i) => (
          <div
            key={i}
            className={`flex justify-between text-sm py-1 ${
              trade.side === "BUY" ? "text-green-600" : "text-red-600"
            }`}
          >
            <span>{(trade.price * 100).toFixed(2)}%</span>
            <span>{trade.size.toFixed(2)}</span>
            <span className="text-gray-400">
              {new Date(trade.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Phase 5: Main Market View Page

**File: `src/views/PolymarketView.tsx`**

```tsx
import { useState } from "react";
import { usePolymarketEvents } from "@/lib/hooks/usePolymarketEvents";
import { usePolymarketMarket } from "@/lib/hooks/usePolymarketMarkets";
import { MarketList } from "@/components/polymarket/MarketList";
import { PriceChart } from "@/components/polymarket/PriceChart";
import { OrderBook } from "@/components/polymarket/OrderBook";
import { TradesFeed } from "@/components/polymarket/TradesFeed";

export function PolymarketView() {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const { data: events } = usePolymarketEvents({ active: true, limit: 10 });
  const { data: market } = usePolymarketMarket(selectedMarketId || "");

  const tokenId = market?.tokenIds?.[0]; // First token ID (usually "Yes" outcome)

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Polymarket</h1>

      <div className="grid grid-cols-12 gap-6">
        {/* Market List Sidebar */}
        <div className="col-span-4">
          <h2 className="font-semibold mb-4">Active Markets</h2>
          <MarketList onSelectMarket={setSelectedMarketId} />
        </div>

        {/* Main Content Area */}
        <div className="col-span-8">
          {selectedMarketId && market ? (
            <div className="space-y-6">
              <div className="border rounded-lg p-4">
                <h2 className="text-xl font-semibold">{market.question}</h2>
                <div className="flex gap-4 mt-2 text-sm text-gray-500">
                  <span>Volume: ${Number(market.volume).toLocaleString()}</span>
                  <span>Spread: {market.spread?.toFixed(2)}%</span>
                </div>
              </div>

              {/* Price Chart */}
              <PriceChart marketId={selectedMarketId} />

              {/* Order Book & Trades */}
              <div className="grid grid-cols-2 gap-6">
                {tokenId && (
                  <>
                    <OrderBook marketId={selectedMarketId} tokenId={tokenId} />
                    <TradesFeed marketId={selectedMarketId} tokenId={tokenId} />
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-12">
              Select a market to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## File Structure

```
client/src/
├── lib/
│   ├── api/
│   │   └── polymarket.ts          # REST API client
│   ├── ws/
│   │   └── polymarketWS.ts        # WebSocket client
│   └── hooks/
│       ├── usePolymarketEvents.ts # Events hooks
│       ├── usePolymarketMarkets.ts# Markets hooks
│       └── usePolymarketStream.ts # Real-time stream hooks
├── components/
│   └── polymarket/
│       ├── MarketList.tsx         # Market listing
│       ├── MarketCard.tsx         # Single market card
│       ├── PriceChart.tsx         # OHLCV chart
│       ├── OrderBook.tsx          # Order book display
│       └── TradesFeed.tsx         # Recent trades
└── views/
    └── PolymarketView.tsx         # Main page
```

---

## Dependencies

```bash
# Required
npm install @tanstack/react-query

# Optional - for charting
npm install lightweight-charts
# or
npm install recharts
```

---

## Quick Start Checklist

- [ ] Create `src/lib/api/polymarket.ts` - REST API client
- [ ] Create `src/lib/ws/polymarketWS.ts` - WebSocket client
- [ ] Create hooks in `src/lib/hooks/`
- [ ] Create components in `src/components/polymarket/`
- [ ] Create main view in `src/views/PolymarketView.tsx`
- [ ] Add route for Polymarket view
- [ ] Test REST API calls
- [ ] Test WebSocket connection
- [ ] Integrate charting library

---

## Notes

- The backend server runs on `http://localhost:3002`
- WebSocket endpoint is at `ws://localhost:3002/ws/pm`
- Token IDs are required for real-time subscriptions (get from market.tokenIds)
- Candle intervals: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`
- The WebSocket will auto-reconnect on disconnect
- Use React Query for caching and automatic refetching
