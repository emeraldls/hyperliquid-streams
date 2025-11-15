import { useEffect } from "react";
import type { WsBook } from "../api";

interface UseOrderBookStreamParams {
  symbol: string;
  wsUrl?: string;
  onMessage?: (book: WsBook) => void;
}

const DEFAULT_WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3000/ws";

export const useOrderBookStream = ({
  symbol,
  wsUrl = DEFAULT_WS_URL,
  onMessage,
}: UseOrderBookStreamParams) => {
  useEffect(() => {
    let active = true;
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      console.info(`[ws] connected to ${wsUrl}`);
    });

    socket.addEventListener("message", (event) => {
      if (!active) {
        return;
      }

      try {
        const payload = JSON.parse(event.data as string);
        if (payload?.channel !== "l2Book" || !payload?.data) {
          return;
        }

        const book = payload.data as WsBook;
        if (book.coin !== symbol) {
          return;
        }

        // console.log(
        //   `[ws] ${book.coin} update @ ${new Date(book.time).toISOString()}`,
        //   book
        // );
        onMessage?.(book);
      } catch (error) {
        console.error("[ws] message parse failed", error);
      }
    });

    socket.addEventListener("close", (event) => {
      console.info(`[ws] disconnected (${event.code})`);
    });

    socket.addEventListener("error", (event) => {
      console.error("[ws] error", event);
    });

    return () => {
      active = false;
      socket.close();
    };
  }, [symbol, wsUrl, onMessage]);
};
