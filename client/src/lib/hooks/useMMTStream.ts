const STREAM_URL =
  "wss://staging-bypass.marketmonkeyterminal.com/ws?token=eyJhbGciOiJIUzI1NiIsImtpZCI6ImFLODNUM1dhUGNydHZubUoiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NzaG9kcGp5cWZxZGVrYmxmaGN4LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiYmMzZWZjYS05M2E2LTRhZjktYjJmNC1lNTJhYmYxZjY3ZGYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY2NDgyOTU1LCJpYXQiOjE3NjU4NzgxNTUsImVtYWlsIjoibGF3cmVuY2VzZWd1bjAyNUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoibGF3cmVuY2VzZWd1bjAyNUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJiYmMzZWZjYS05M2E2LTRhZjktYjJmNC1lNTJhYmYxZjY3ZGYifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2NTg3ODE1NX1dLCJzZXNzaW9uX2lkIjoiZjk5NDc4MjItZjdlMy00YWYwLTkwYTEtNTNhOTMxNzkwODg3IiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.MomxjeHyXyeEBrt1043hUcZ0sgF42Ahbuczr93Lc3Sw";

import { decode } from "cbor2";
import { useEffect, useRef, useState, useCallback } from "react";
import type { WsBook, WsLevel } from "../api";

interface UseOrderBookStreamParams {
  symbol: string;
}

interface WSPayload {
  0: { 0: string; 1: string } | null; // pair: { exchange, symbol }
  1: number; // stream (Stream enum)
  2: number; // timeframe
  3: Uint8Array; // data (nested CBOR)
}

// Orderbook structure
interface Orderbook {
  0: number; // unix
  1: { 0: string; 1: string }; // pair
  2: number[]; // askPrices
  3: number[]; // askSizes
  4: number[]; // bidPrices
  5: number[]; // bidSizes
  6: number; // lastPrice
  7: boolean; // snapshot
  8: number; // seq
}

export const useMMTStream = ({ symbol }: UseOrderBookStreamParams) => {
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [book, setBook] = useState<WsBook | null>(null);

  const send = useCallback((message: object) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[ws] cannot send, socket not connected");
    }
  }, []);

  const subscribe = useCallback(() => {
    send({
      method: "subscribe",
      data: {
        pair: {
          symbol: symbol,
          exchange: "binancef",
        },
        stream: 1,
        timeframe: 0,
      },
    });
  }, [send, symbol]);

  const unsubscribe = useCallback(() => {
    send({
      method: "unsubscribe",
      data: {
        pair: {
          symbol: symbol,
          exchange: "binancef",
        },
        stream: 1,
      },
    });

    // socketRef.current?.close();
  }, [send, symbol]);

  useEffect(() => {
    let active = true;
    const socket = new WebSocket(STREAM_URL);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      console.info(`[ws] connected to ${STREAM_URL}`);
      if (active) {
        setIsConnected(true);
      }
    });

    socket.addEventListener("message", async (event) => {
      if (!active) return;

      let bytes: Uint8Array;

      if (event.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(event.data);
      } else if (event.data instanceof Blob) {
        const buffer = await event.data.arrayBuffer();
        bytes = new Uint8Array(buffer);
      } else {
        console.log("Text message:", event.data);
        return;
      }

      if (bytes.length === 0) {
        console.log("Empty message received");
        return;
      }

      try {
        // Decode outer WSPayload
        const payload = decode(bytes) as WSPayload;

        // const pair = payload[0]; // { 0: exchange, 1: symbol }
        // const streamType = payload[1]; // Stream enum value
        // const timeframe = payload[2];
        const innerData = payload[3]; // Nested CBOR bytes

        // console.log("Stream:", streamType);
        // console.log("Pair:", pair ? `${pair[0]}/${pair[1]}` : null);
        // console.log("Timeframe:", timeframe);
        // console.log(btoa(String.fromCharCode(...innerData)));

        const orderbook = decode(innerData) as Orderbook;

        const bids: WsLevel[] = orderbook[4].map((px, i) => ({
          px: px.toString(),
          sz: orderbook[5][i].toString(),
          n: 0,
        }));
        const asks: WsLevel[] = orderbook[2].map((px, i) => ({
          px: px.toString(),
          sz: orderbook[3][i].toString(),
          n: 0,
        }));

        const newBook: WsBook = {
          coin: orderbook[1][1],
          levels: [bids, asks],
          time: orderbook[0],
        };
        setBook(newBook);
      } catch (err) {
        console.error("Failed to decode CBOR:", err);
      }
    });
    socket.addEventListener("close", (event) => {
      console.info(`[ws] disconnected (${event.code})`);
      if (active) {
        setIsConnected(false);
      }
    });

    socket.addEventListener("error", (event) => {
      console.error("[ws] error", event);
    });

    return () => {
      active = false;
      socket.close();
      socketRef.current = null;
    };
  }, [symbol]);

  return { send, subscribe, unsubscribe, isConnected, book };
};
