import WebSocket from "ws";
import type { WsBook, WsLiquidation, WsUserTwapHistory } from "./types";
import { DatabaseClient } from "./db";

type L2BookHandler = (book: WsBook) => void;
type LiquidationHandler = (liq: WsLiquidation) => void;
type UserPositionsHandler = (positions: WsUserTwapHistory) => void;

export class HyperliquidClient {
  private ws: WebSocket;
  private l2BookHandlers: L2BookHandler[] = [];
  private liquidationHandlers: LiquidationHandler[] = [];
  private userPositionsHandlers: UserPositionsHandler[] = [];

  constructor() {
    this.ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
    this.setupListeners();
  }

  private setupListeners() {
    this.ws.on("open", () => {
      console.log("Connected to Hyperliquid WS");
    });

    this.ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.error("JSON parse error:", e);
        return;
      }

      //   console.log("HL message:", JSON.stringify(msg, null, 2));

      if (msg.channel === "l2Book") {
        const book = msg.data as WsBook;
        this.l2BookHandlers.forEach((h) => h(book));
      } else if (msg.channel === "liquidations") {
        const liq = msg.data as WsLiquidation;
        this.liquidationHandlers.forEach((h) => h(liq));
      } else if (msg.channel === "userPositions") {
        const positions = msg.data as WsUserTwapHistory;
        this.userPositionsHandlers.forEach((h) => h(positions));
      }
    });

    this.ws.on("close", () => {
      console.log("Disconnected from Hyperliquid WS");
    });

    this.ws.on("error", (err) => {
      console.error("Hyperliquid WS error:", err);
    });
  }

  private send(sub: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(sub));
    } else {
      this.ws.once("open", () => {
        this.ws.send(JSON.stringify(sub));
      });
    }
  }

  subscribeL2Book(coin: string, handler: L2BookHandler) {
    this.l2BookHandlers.push(handler);
    this.send({
      method: "subscribe",
      subscription: {
        type: "l2Book",
        coin,
      },
    });
  }

  subscribeLiquidations(coin: string, handler: LiquidationHandler) {
    this.liquidationHandlers.push(handler);
    this.send({
      method: "subscribe",
      subscription: {
        type: "liquidations",
        coin,
      },
    });
  }

  subscribeUserPositions(user: string, handler: UserPositionsHandler) {
    this.userPositionsHandlers.push(handler);
    this.send({
      method: "subscribe",
      subscription: {
        type: "userPositions",
        user,
      },
    });
  }
}
