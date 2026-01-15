const STREAM_URL =
  "wss://eu-central.marketmonkeyterminal.com/ws?token=eyJhbGciOiJIUzI1NiIsImtpZCI6ImFaRHZDMitaQ0pQNW1lTy8iLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NheWNianduYnF0bmtneWNraWloLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIyMWI4ZWZjYy1jNDkzLTRiOGMtOTUxMy01NmQ3NDFlM2Y2OTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY1ODg2MTM1LCJpYXQiOjE3NjUyODEzMzUsImVtYWlsIjoibGF3cmVuY2VzZWd1bjAyNUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIiwiZ29vZ2xlIl19LCJ1c2VyX21ldGFkYXRhIjp7ImF2YXRhcl91cmwiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NKSDNSMHVUZ3hpWWYwVGl6V0Y1ZzdKX3d6d3Q4SlN6SU5oRWlidlhUWlNjZXFNY2c9czk2LWMiLCJlbWFpbCI6Imxhd3JlbmNlc2VndW4wMjVAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZ1bGxfbmFtZSI6Ikxhd3JlbmNlIFNlZ3VuIiwiaXNzIjoiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tIiwibmFtZSI6Ikxhd3JlbmNlIFNlZ3VuIiwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jSkgzUjB1VGd4aVlmMFRpeldGNWc3Sl93end0OEpTeklOaEVpYnZYVFpTY2VxTWNnPXM5Ni1jIiwicHJvdmlkZXJfaWQiOiIxMTI4NTgwMTY4NjY3ODM0NjQ5OTQiLCJzdWIiOiIxMTI4NTgwMTY4NjY3ODM0NjQ5OTQifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2NTI4MTMzNX1dLCJzZXNzaW9uX2lkIjoiYjFkNDFiN2MtYzJlOC00ZDdiLTg4NTItMmNiM2VlY2I4YzVkIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.7A04NRsglFv6WiVaLh6F_dczvvI7h7Kwduaiag6BcqY";

import { decode } from "cbor2";
import { useEffect, useRef, useState, useCallback } from "react";
import type { WsBook, WsLevel } from "../api";

interface UseOrderBookStreamParams {
  symbol: string;
  onMessage?: (book: WsBook) => void;
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

export const useMMTStream = ({
  symbol,
  onMessage,
}: UseOrderBookStreamParams) => {
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

        console.log(btoa(String.fromCharCode(...bytes)));

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

        if (onMessage) {
          onMessage(newBook);
        }
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
  }, [symbol, onMessage]);

  return { send, subscribe, unsubscribe, isConnected };
};
