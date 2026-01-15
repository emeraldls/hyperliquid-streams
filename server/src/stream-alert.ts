import WebSocket from "ws";
import crypto from "crypto";
import {
  AlertSettings,
  ComparisonOperator,
  dispatchAlert,
  evaluateAlert,
  TriggerMode,
} from "./alert";
import { Request, Response } from "express";

interface MMTWSPayload {
  0: { 0: string; 1: string } | null; // pair: { exchange, symbol }
  1: number; // stream (Stream enum)
  2: number; // timeframe
  3: Uint8Array; // data (nested CBOR)
}

/*
    When a user sends a post request to create an alert,
    we instantiate this MMTClient to open a websocket connection
    to MMT's stream server to listen for price updates.

    Once a price update is received, we evaluate the alert conditions
    and trigger the alert if conditions are met.
*/

const STREAM_URL =
  "wss://staging-bypass.marketmonkeyterminal.com/ws?token=eyJhbGciOiJIUzI1NiIsImtpZCI6ImFLODNUM1dhUGNydHZubUoiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NzaG9kcGp5cWZxZGVrYmxmaGN4LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiYmMzZWZjYS05M2E2LTRhZjktYjJmNC1lNTJhYmYxZjY3ZGYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY2NDgyOTU1LCJpYXQiOjE3NjU4NzgxNTUsImVtYWlsIjoibGF3cmVuY2VzZWd1bjAyNUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoibGF3cmVuY2VzZWd1bjAyNUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJiYmMzZWZjYS05M2E2LTRhZjktYjJmNC1lNTJhYmYxZjY3ZGYifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2NTg3ODE1NX1dLCJzZXNzaW9uX2lkIjoiZjk5NDc4MjItZjdlMy00YWYwLTkwYTEtNTNhOTMxNzkwODg3IiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.MomxjeHyXyeEBrt1043hUcZ0sgF42Ahbuczr93Lc3Sw";

class AlertRegistry {
  private alerts = new Map<string, AlertSettings>();

  add(alert: AlertSettings) {
    console.log("Registering alert:", alert.id);
    this.alerts.set(alert.id, alert);
  }

  remove(alertId: string) {
    this.alerts.delete(alertId);
  }

  get(alertId: string) {
    return this.alerts.get(alertId);
  }
}

const alertRegistry = new AlertRegistry();

// per mmt symbol stream
class SymbolStream {
  private ws: WebSocket;
  private alerts = new Set<AlertSettings>();
  private connected = false;

  constructor(private symbol: string) {
    this.ws = new WebSocket(STREAM_URL);
    this.setup();
  }

  addAlert(alert: AlertSettings) {
    this.alerts.add(alert);
  }

  removeAlert(alertId: string) {
    for (const alert of this.alerts) {
      if (alert.id === alertId) {
        this.alerts.delete(alert);
        break;
      }
    }
  }

  //   subscribe to mmt
  private setup() {
    this.ws.on("open", () => {
      console.log(`🟢 WS connected for ${this.symbol}`);

      this.ws.send(
        JSON.stringify({
          method: "subscribe",
          data: {
            pair: {
              symbol: this.symbol,
              exchange: "binancef",
            },
            stream: 0,
            timeframe: 0,
          },
        })
      );
      this.connected = true;
    });

    this.ws.on("message", async (data, isBinary) => {
      if (!this.connected) return;

      let bytes: Uint8Array;

      if (isBinary) {
        if (Buffer.isBuffer(data)) {
          bytes = new Uint8Array(data);
        }
      }

      try {
        const { decode } = await import("cbor2");
        const payload = decode(bytes) as MMTWSPayload;
        const innerData = payload[3];
        const tradeData = decode(innerData);
        const pair = tradeData[1];

        const mmtTrade: MMTTrade = {
          0: tradeData[0],
          1: {
            0: pair[0],
            1: pair[1],
          },
          2: tradeData[2],
          3: tradeData[3],
          4: tradeData[4],
          5: tradeData[5],
        };

        const trade: Trade = {
          id: mmtTrade[0],
          pair: {
            exchange: mmtTrade[1][0],
            symbol: mmtTrade[1][1],
          },
          unix: mmtTrade[2],
          price: mmtTrade[3],
          qty: mmtTrade[4],
          is_buy: mmtTrade[5],
        };

        const price = trade.price;
        const now = Date.now();

        for (const alert of this.alerts) {
          if (alert.status !== "active") continue;
          if (alert.expiresAt && alert.expiresAt < now) {
            alert.status = "expired";
            continue;
          }

          const triggered = evaluateAlert(alert, price);

          if (triggered) {
            dispatchAlert(alert, price);

            if (alert.trigger === "once") {
              alert.status = "triggered";
            }
          }
        }
      } catch (err) {
        console.error("Failed to decode MMT message:", err);
        return;
      }
    });

    this.ws.on("close", () => {
      console.log(`🔴 WS closed for ${this.symbol}`);
    });

    this.ws.on("error", (err) => {
      console.error(`WS error for ${this.symbol}`, err);
    });
  }
}

class StreamManager {
  private streams = new Map<string, SymbolStream>();

  getStream(symbol: string): SymbolStream {
    let stream = this.streams.get(symbol);

    if (!stream) {
      stream = new SymbolStream(symbol);
      this.streams.set(symbol, stream);
    }

    return stream;
  }

  removeAlert(symbol: string, alertId: string) {
    const stream = this.streams.get(symbol);
    if (!stream) return;
    stream.removeAlert(alertId);
  }
}

const streamManager = new StreamManager();

export function createAlert(input: {
  userId: string;
  symbol: string;
  operator: ComparisonOperator;
  value: number;
  trigger?: TriggerMode;
  expiresAt?: number;
}): AlertSettings {
  const alert: AlertSettings = {
    id: crypto.randomUUID(),
    userId: input.userId,

    symbol: input.symbol,
    field: "last_price",

    operator: input.operator,
    value: input.value,

    trigger: input.trigger ?? "once",
    status: "active",

    createdAt: Date.now(),
    expiresAt: input.expiresAt,
  };

  alertRegistry.add(alert);
  streamManager.getStream(alert.symbol).addAlert(alert);

  return alert;
}

export const apiCreateAlert = async (req: Request, res: Response) => {
  try {
    const { userId, symbol, operator, value, trigger } = req.body;

    if (!userId || !symbol || !operator || typeof value !== "number") {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const expiresAt = Date.now() + 60 * 1000;

    const alert = createAlert({
      userId,
      symbol,
      operator,
      value,
      trigger,
      expiresAt,
    });

    res.status(201).json({ alert });
  } catch (error) {
    console.error("Failed to create alert:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export function deleteAlert(alert: AlertSettings) {
  alert.status = "disabled";
  alertRegistry.remove(alert.id);
  streamManager.removeAlert(alert.symbol, alert.id);
}

export const apiDeleteAlert = async (req: Request, res: Response) => {
  try {
    const alertId = req.params.id;
    const alert = alertRegistry.get(alertId);

    if (!alert) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    deleteAlert(alert);
    res.status(200).json({ message: "Alert deleted" });
  } catch (error) {
    console.error("Failed to delete alert:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const apiGetMyAlerts = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: "Missing userId" });
      return;
    }

    const alerts = Array.from(alertRegistry["alerts"].values()).filter(
      (alert) => alert.userId === userId
    );

    res.status(200).json({ alerts });
  } catch (error) {
    console.error("Failed to get alerts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

type MMTTrade = {
  0: string; // trade id
  1: { 0: string; 1: string }; // pair: { exchange, symbol }
  2: number; // unix timestamp
  3: number; // price
  4: number; // quantity
  5: boolean; // is_buy
};

type Trade = {
  id: string;
  pair: {
    exchange: string;
    symbol: string;
  };
  unix: number;
  price: number;
  qty: number;
  is_buy: boolean;
};
