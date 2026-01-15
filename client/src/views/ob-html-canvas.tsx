import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrderBook, type WsBook } from "@/lib/api";
import { useOrderBookStream } from "@/lib/hooks/useOrderBookStream";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CANVAS_WIDTH = Math.floor(window.innerWidth * 0.6);
const CANVAS_HEIGHT = Math.floor(window.innerHeight * 0.85);

const SIDE_WIDTH = CANVAS_WIDTH / 2;

const DEFAULT_SYMBOL = "BTC";
const SYMBOL_OPTIONS = ["BTC", "ETH", "SOL", "ADA", "BNB"] as const;
type SymbolTicker = (typeof SYMBOL_OPTIONS)[number];

const OrderbookWithHtmlCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dprRef = useRef<number>(1);
  const animationFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const fpsRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsUpdateTimeRef = useRef<number>(performance.now());
  const [symbol, setSymbol] = useState<SymbolTicker>(DEFAULT_SYMBOL);
  const [liveBook, setLiveBook] = useState<WsBook | undefined>();
  const [fps, setFps] = useState<number>(0);

  const { data: books, isLoading } = useQuery<WsBook[]>({
    queryKey: ["orderbook", symbol],
    queryFn: () => fetchOrderBook(symbol),
    staleTime: 15_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useOrderBookStream({
    symbol,
    onMessage: setLiveBook,
  });

  const lastSnapshot = useMemo(() => books?.[0], [books]);
  const activeBook = liveBook ?? lastSnapshot;

  const handleSymbolChange = (value: SymbolTicker) => {
    setLiveBook(undefined);
    setSymbol(value);
  };

  const clearCanvas = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  const drawDepthRow = useCallback(
    ({
      price,
      size,
      total,
      side,
      rowIndex,
      maxTotal,
    }: {
      price: number;
      size: number;
      total: number;
      side: "ask" | "bid";
      rowIndex: number;
      maxTotal: number;
    }) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      const ROW_HEIGHT = 25;
      const START_Y = 150;
      const y = START_Y + rowIndex * ROW_HEIGHT;

      // Calculate depth bar width as percentage of max total
      const depthPercent = maxTotal > 0 ? total / maxTotal : 0;
      const depthWidth = (SIDE_WIDTH - 60) * depthPercent;

      // Determine which side to draw on
      const xOffset = side === "ask" ? 0 : SIDE_WIDTH;

      // Draw depth background bar
      ctx.fillStyle =
        side === "ask" ? "rgba(255, 82, 82, 0.15)" : "rgba(16, 185, 129, 0.15)";
      if (side === "ask") {
        ctx.fillRect(xOffset + 30, y - ROW_HEIGHT + 8, depthWidth, ROW_HEIGHT);
      } else {
        ctx.fillRect(
          xOffset + SIDE_WIDTH - 30 - depthWidth,
          y - ROW_HEIGHT + 5,
          depthWidth,
          ROW_HEIGHT
        );
      }

      // Draw text values
      ctx.fillStyle = side === "ask" ? "#dc2626" : "#10b981";
      ctx.font = "13px monospace";

      // Price
      ctx.textAlign = "left";
      ctx.fillText(price.toFixed(2), xOffset + 50, y);

      // Size
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.fillText(size.toFixed(4), xOffset + SIDE_WIDTH / 2, y);

      // Total
      ctx.textAlign = "right";
      ctx.fillText(total.toFixed(4), xOffset + SIDE_WIDTH - 50, y);
    },
    []
  );

  const drawOrderBookSide = useCallback(({ side }: { side: "ask" | "bid" }) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const TOP = 100;

    if (side == "ask") {
      ctx.fillStyle = "rgba(0, 255, 0, 1)";
      ctx.font = "15px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Asks", 30, 70);

      ctx.font = "12px Arial";
      ctx.fillStyle = "#888888";
      ctx.textAlign = "left";
      ctx.fillText("price", 50, TOP);
      ctx.textAlign = "center";
      ctx.fillText("size", SIDE_WIDTH / 2, TOP);
      ctx.textAlign = "right";
      ctx.fillText("sum", SIDE_WIDTH - 50, TOP);
    } else {
      ctx.fillStyle = "rgba(255, 82, 82, 1)";
      ctx.font = "15px Arial";
      ctx.textAlign = "right";
      ctx.fillText("Bids", CANVAS_WIDTH - 30, 70);

      ctx.font = "12px Arial";
      ctx.fillStyle = "#888888";
      ctx.textAlign = "left";
      ctx.fillText("price", SIDE_WIDTH + 50, TOP);
      ctx.textAlign = "center";
      ctx.fillText("size", SIDE_WIDTH + SIDE_WIDTH / 2, TOP);
      ctx.textAlign = "right";
      ctx.fillText("sum", CANVAS_WIDTH - 50, TOP);
    }
  }, []);

  const drawOrderbook = useCallback(
    (book?: WsBook) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      clearCanvas();

      // Background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Title
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.font = "bold 24px Arial";
      ctx.fillText(`${symbol} Order Book`, CANVAS_WIDTH / 2, 40);

      drawOrderBookSide({ side: "ask" });
      drawOrderBookSide({ side: "bid" });

      // Header separator line
      ctx.strokeStyle = "#333333";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, 110);
      ctx.lineTo(CANVAS_WIDTH - 30, 110);
      ctx.stroke();

      // Vertical divider
      ctx.strokeStyle = "#333333";
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 110);
      ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
      ctx.stroke();

      if (!book || !book.levels) {
        // Loading state
        ctx.fillStyle = "#666666";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText(
          isLoading ? "Loading..." : "No data available",
          CANVAS_WIDTH / 2,
          CANVAS_HEIGHT / 2
        );
        return;
      }

      const [rawAsks, rawBids] = book.levels;
      const maxRows = 20;

      // Process asks - reverse to show highest first
      const asks = rawAsks
        .slice(0, maxRows)
        .reverse()
        .map((level) => ({
          price: parseFloat(level.px),
          size: parseFloat(level.sz),
        }));

      // Calculate cumulative totals for asks
      let askTotal = 0;
      const asksWithTotal = asks.map((ask) => {
        askTotal += ask.size;
        return { ...ask, total: askTotal };
      });

      // Process bids - already in descending order
      const bids = rawBids.slice(0, maxRows).map((level) => ({
        price: parseFloat(level.px),
        size: parseFloat(level.sz),
      }));

      // Calculate cumulative totals for bids
      let bidTotal = 0;
      const bidsWithTotal = bids.map((bid) => {
        bidTotal += bid.size;
        return { ...bid, total: bidTotal };
      });

      // Find max total for depth visualization
      const maxAskTotal = asksWithTotal[asksWithTotal.length - 1]?.total || 0;
      const maxBidTotal = bidsWithTotal[bidsWithTotal.length - 1]?.total || 0;
      const maxTotal = Math.max(maxAskTotal, maxBidTotal);

      // Draw mid price
      if (asks.length > 0 && bids.length > 0) {
        const midPrice = (asks[0].price + bids[0].price) / 2;
        ctx.fillStyle = "#888888";
        ctx.font = "16px monospace";
        ctx.textAlign = "center";
        ctx.fillText(midPrice.toFixed(2), CANVAS_WIDTH / 2, 135);
      }

      // Draw asks
      asksWithTotal.forEach((ask, index) => {
        drawDepthRow({
          price: ask.price,
          size: ask.size,
          total: ask.total,
          side: "ask",
          rowIndex: index,
          maxTotal,
        });
      });

      // Draw bids
      bidsWithTotal.forEach((bid, index) => {
        drawDepthRow({
          price: bid.price,
          size: bid.size,
          total: bid.total,
          side: "bid",
          rowIndex: index,
          maxTotal,
        });
      });
    },
    [clearCanvas, drawOrderBookSide, drawDepthRow, symbol, isLoading]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;

    ctx.scale(dpr, dpr);

    ctxRef.current = ctx;

    const animate = (currentTime: number) => {
      lastFrameTimeRef.current = currentTime;

      // Calculate FPS
      frameCountRef.current++;
      const timeSinceLastFpsUpdate = currentTime - fpsUpdateTimeRef.current;

      // Update FPS every 500ms
      if (timeSinceLastFpsUpdate >= 500) {
        const currentFps =
          (frameCountRef.current * 1000) / timeSinceLastFpsUpdate;
        fpsRef.current = currentFps;
        setFps(Math.round(currentFps));
        frameCountRef.current = 0;
        fpsUpdateTimeRef.current = currentTime;
      }

      // Draw the orderbook
      drawOrderbook(activeBook);

      // Continue the loop
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      // Cancel the animation loop on cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      ctxRef.current = null;
    };
  }, [drawOrderbook, activeBook]);

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="flex w-full max-w-4xl items-center justify-between">
        <h2 className="text-2xl font-bold">Order Book with Canvas</h2>
        <div className="flex items-center gap-4">
          <div className="rounded-md bg-green-500/10 px-3 py-1 font-mono text-sm font-bold text-green-500">
            {fps} FPS
          </div>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          border: "1px solid #333",
          borderRadius: "8px",
          backgroundColor: "#0a0a0a",
        }}
      />
    </div>
  );
};

export default OrderbookWithHtmlCanvas;
