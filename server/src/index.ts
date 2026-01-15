import http from "node:http";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { HyperliquidClient } from "./hy-client";
import { dataEvents } from "./data-events";
import { DatabaseClient } from "./db";
import type { WsBook } from "./types";
import { apiCreateAlert, apiGetMyAlerts } from "./stream-alert";
import { userStreams } from "./user-streams";
import { URL } from "node:url";
import cors from "cors";
import {
  polymarketRouter,
  initPolymarket,
  setupGracefulShutdown,
  polymarketWss,
} from "./polymarket";

/*
 Application Workflow
 ws client which reads for hyperliquid & saved to sqlite
 then my own ws server which serves my own clients
 we're gonna use event emitter pattern here
*/

const dbClient = new DatabaseClient();
dbClient.boostrapTables();
const client = new HyperliquidClient();

const PORT = Number(process.env.PORT ?? 3002);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// cors

app.use(cors());

app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

const parsePositiveInt = (value: string | null, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getQueryParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

app.get(["/orderbook", "/api/orderbook"], (req, res) => {
  const symbolParam = getQueryParam(
    (req.query.symbol as string | undefined) ??
      (req.query.coin as string | undefined)
  );
  const limit = parsePositiveInt(
    getQueryParam(req.query.limit as string | undefined),
    10
  );
  const timestampParam = getQueryParam(
    req.query.timestamp as string | undefined
  );
  const timestamp = timestampParam ? Number(timestampParam) : undefined;

  try {
    if (symbolParam) {
      const books = dbClient.getOrderBooksByCoin(symbolParam, limit);
      res.status(200).json({ data: books });
      return;
    }

    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      const books = dbClient.getAllOrderBooks(limit, timestamp);
      res.status(200).json({ data: books });
      return;
    }

    const books = dbClient.getAllOrderBooks(limit);
    res.status(200).json({ data: books });
  } catch (error) {
    console.error("Orderbook query failed", error);
    res.status(500).json({ error: "Failed to query order books" });
  }
});

app.post("/alert", apiCreateAlert);
app.get("/alert", apiGetMyAlerts);

app.get("/events", (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write("\n");

  let streams = userStreams.get(userId);
  if (!streams) {
    streams = new Set();
    userStreams.set(userId, streams);
  }

  streams.add(res);

  req.on("close", () => {
    streams!.delete(res);
    if (streams!.size === 0) {
      userStreams.delete(userId);
    }
  });
});

app.get(["/health", "/api/health"], (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Mount Polymarket routes
app.use("/api/pm", polymarketRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

const broadcastBook = (book: WsBook) => {
  const payload = JSON.stringify({ channel: "l2Book", data: book });
  wss.clients.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  });
};

dataEvents.on("l2Book", broadcastBook);

wss.on("connection", (socket) => {
  console.log("Client connected to internal WS");

  socket.on("close", () => {
    console.log("Client disconnected from internal WS");
  });

  socket.on("error", (err) => {
    console.error("Internal WS client error", err);
  });
});

server.on("upgrade", (request, socket, head) => {
  const pathname = request.url;

  if (pathname === "/ws/pm") {
    polymarketWss?.handleUpgrade(request, socket, head, (ws) => {
      polymarketWss.emit("connection", ws, request);
    });
  } else if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

const startServer = async () => {
  console.log(`HTTP+WS server listening on http://localhost:${PORT}`);

  // Initialize Polymarket module
  try {
    await initPolymarket();
    console.log("Polymarket module initialized");
  } catch (err) {
    console.error("Failed to initialize Polymarket module:", err);
  }

  server.listen(PORT);
};

startServer();

// Set up graceful shutdown for Polymarket
setupGracefulShutdown();

client.subscribeL2Book("BTC", (book) => {
  dbClient.saveL2Book(book);
  dataEvents.emit("l2Book", book);
});

/* i need to build 3 endpoints for this application & expose to my own clients to connect to.
1. Order Book Data (l2Book) - /api/orderbook?symbol=BTC
2. Liquidation Events - /api/liquidations?symbol=BTC
3. Positions and PnL Updates - /api/positions?address=USER_ID

*/
