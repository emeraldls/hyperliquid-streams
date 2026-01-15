import { useMMTStream } from "@/lib/hooks/useMMTStream";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import type { WsBook } from "@/lib/api";

const CANVAS_WIDTH = Math.floor(window.innerWidth * 0.6);
const CANVAS_HEIGHT = Math.floor(window.innerHeight * 0.85);

const DEFAULT_SYMBOL = "BTC";

const symbol = "btc/usd";

const MMTOb = () => {
  const { subscribe, unsubscribe, isConnected, book } = useMMTStream({
    symbol,
  });

  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = () => {
    subscribe();
    setIsSubscribed(true);
  };

  const handleUnsubscribe = () => {
    unsubscribe();
    setIsSubscribed(false);
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dprRef = useRef<number>(1);
  const animationFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const fpsRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsUpdateTimeRef = useRef<number>(performance.now());
  const [fps, setFps] = useState<number>(0);
  const lineYRef = useRef<number>(CANVAS_HEIGHT / 2 - 150);
  const oppositeLineYRef = useRef<number>(CANVAS_HEIGHT - lineYRef.current);
  const hitTolerance = useMemo(() => 5, []);
  const boundaryYRef = useRef<{ min: number; max: number; between: number }>({
    min: 50,
    max: CANVAS_HEIGHT - 50,
    between: 50,
  });

  const isDraggingRef = useRef<boolean>(false);

  const drawAdjustRangeLine = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, lineYRef.current);
    ctx.lineTo(CANVAS_WIDTH, lineYRef.current);
    ctx.stroke();
  }, []);

  const drawOppositeAdjustRangeLine = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, oppositeLineYRef.current);
    ctx.lineTo(CANVAS_WIDTH, oppositeLineYRef.current);
    ctx.stroke();
  }, []);

  const isOverLine = useCallback(
    (mouseY: number) => {
      return Math.abs(mouseY - lineYRef.current) <= hitTolerance;
    },
    [hitTolerance]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseY = event.clientY - rect.top;
      if (isOverLine(mouseY)) {
        isDraggingRef.current = true;
        canvas.style.cursor = "ns-resize";
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const mouseY = event.clientY - rect.top;

      const minY = boundaryYRef.current.min;
      const gap = boundaryYRef.current.between;

      const maxAllowedY = oppositeLineYRef.current - gap;

      const nextY = Math.min(maxAllowedY, Math.max(minY, mouseY));

      lineYRef.current = nextY;
      oppositeLineYRef.current = CANVAS_HEIGHT - nextY;
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      canvas.style.cursor = "default";
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drawAdjustRangeLine, isOverLine]);

  const clearCanvas = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  const drawHeader = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const TOP = 80;
    ctx.font = "12px Arial";
    ctx.fillStyle = "#888888";

    ctx.textAlign = "left";
    ctx.fillText("Price", 50, TOP);
    ctx.textAlign = "center";
    ctx.fillText("Size", CANVAS_WIDTH / 2, TOP);
    ctx.textAlign = "right";
    ctx.fillText("Sum", CANVAS_WIDTH - 50, TOP);
  }, []);

  const drawVerticalDepthRow = useCallback(
    ({
      price,
      size,
      total,
      side,
      y,
      maxTotal,
    }: {
      price: number;
      size: number;
      total: number;
      side: "ask" | "bid";
      y: number;
      maxTotal: number;
    }) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      const ROW_HEIGHT = 25;

      // Calculate depth bar width as percentage of max total
      const depthPercent = maxTotal > 0 ? total / maxTotal : 0;
      const depthWidth = (CANVAS_WIDTH - 60) * depthPercent;

      // Draw depth background bar
      ctx.fillStyle =
        side === "ask" ? "rgba(255, 82, 82, 0.15)" : "rgba(16, 185, 129, 0.15)";

      ctx.fillRect(
        CANVAS_WIDTH - 30 - depthWidth,
        y - ROW_HEIGHT + 5,
        depthWidth,
        ROW_HEIGHT
      );

      // Draw text values
      ctx.fillStyle = side === "ask" ? "#dc2626" : "#10b981";
      ctx.font = "13px monospace";

      // Price
      ctx.textAlign = "left";
      ctx.fillText(price.toFixed(2), 50, y);

      // Size
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.fillText(size.toFixed(4), CANVAS_WIDTH / 2, y);

      // Total
      ctx.textAlign = "right";
      ctx.fillText(total.toFixed(4), CANVAS_WIDTH - 50, y);
    },
    []
  );

  const drawOrderbook = useCallback(
    (book: WsBook | null) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      clearCanvas();

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.font = "bold 24px Arial";
      ctx.fillText(`${symbol} Order Book`, CANVAS_WIDTH / 2, 40);

      drawHeader();

      ctx.strokeStyle = "#333333";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, 90);
      ctx.lineTo(CANVAS_WIDTH - 30, 90);
      ctx.stroke();

      if (!book || !book.levels) {
        ctx.fillStyle = "#666666";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("No data available", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        return;
      }

      const [rawAsks, rawBids] = book.levels;

      const MID_Y = CANVAS_HEIGHT / 2;
      const ROW_HEIGHT = 25;
      const maxRows = Math.floor((MID_Y - 120) / ROW_HEIGHT);

      const asks = rawAsks.slice(0, maxRows).map((level) => ({
        price: parseFloat(level.px),
        size: parseFloat(level.sz),
      }));

      let askTotal = 0;
      const asksWithTotal = asks.map((ask) => {
        askTotal += ask.size;
        return { ...ask, total: askTotal };
      });

      const bids = rawBids.slice(0, maxRows).map((level) => ({
        price: parseFloat(level.px),
        size: parseFloat(level.sz),
      }));

      let bidTotal = 0;
      const bidsWithTotal = bids.map((bid) => {
        bidTotal += bid.size;
        return { ...bid, total: bidTotal };
      });

      const maxAskTotal = asksWithTotal[asksWithTotal.length - 1]?.total || 0;
      const maxBidTotal = bidsWithTotal[bidsWithTotal.length - 1]?.total || 0;
      const maxTotal = Math.max(maxAskTotal, maxBidTotal);

      if (asks.length > 0 && bids.length > 0) {
        const midPrice = (asks[0].price + bids[0].price) / 2;
        ctx.fillStyle = "#888888";
        ctx.font = "16px monospace";
        ctx.textAlign = "center";
        ctx.fillText(midPrice.toFixed(2), CANVAS_WIDTH / 2, MID_Y + 5);
      }

      const CENTER_GAP = 40;
      const ASKS_BOTTOM = MID_Y - CENTER_GAP / 2;
      const BIDS_TOP = MID_Y + CENTER_GAP / 2 + 20;

      let currentAskSum = 0;
      const askLineY = lineYRef.current;

      if (askLineY < ASKS_BOTTOM) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.1)";
        ctx.fillRect(0, askLineY, CANVAS_WIDTH, ASKS_BOTTOM - askLineY);
      }

      asksWithTotal.forEach((ask, index) => {
        const y = ASKS_BOTTOM - index * ROW_HEIGHT;

        if (y >= askLineY) {
          currentAskSum += ask.size;
        }

        drawVerticalDepthRow({
          price: ask.price,
          size: ask.size,
          total: ask.total,
          side: "ask",
          y,
          maxTotal,
        });
      });

      if (currentAskSum > 0) {
        ctx.fillStyle = "#dc2626";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "right";
        ctx.fillText(
          `Sum: ${currentAskSum.toFixed(4)}`,
          CANVAS_WIDTH - 10,
          askLineY - 5
        );
      }

      let currentBidSum = 0;
      const bidLineY = oppositeLineYRef.current;

      if (bidLineY > BIDS_TOP) {
        ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
        ctx.fillRect(0, BIDS_TOP, CANVAS_WIDTH, bidLineY - BIDS_TOP);
      }

      bidsWithTotal.forEach((bid, index) => {
        const y = BIDS_TOP + index * ROW_HEIGHT;

        if (y <= bidLineY) {
          currentBidSum += bid.size;
        }

        drawVerticalDepthRow({
          price: bid.price,
          size: bid.size,
          total: bid.total,
          side: "bid",
          y,
          maxTotal,
        });
      });

      if (currentBidSum > 0) {
        ctx.fillStyle = "#10b981";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "right";
        ctx.fillText(
          `Sum: ${currentBidSum.toFixed(4)}`,
          CANVAS_WIDTH - 10,
          bidLineY + 15
        );
      }
    },
    [clearCanvas, drawHeader, drawVerticalDepthRow]
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

      frameCountRef.current++;
      const timeSinceLastFpsUpdate = currentTime - fpsUpdateTimeRef.current;

      if (timeSinceLastFpsUpdate >= 500) {
        const currentFps =
          (frameCountRef.current * 1000) / timeSinceLastFpsUpdate;
        fpsRef.current = currentFps;
        setFps(Math.round(currentFps));
        frameCountRef.current = 0;
        fpsUpdateTimeRef.current = currentTime;
      }

      drawOrderbook(book);
      drawAdjustRangeLine();
      drawOppositeAdjustRangeLine();

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      ctxRef.current = null;
    };
  }, [drawOrderbook, book, drawAdjustRangeLine, drawOppositeAdjustRangeLine]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">MMT Order Book</h1>
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span>{isConnected ? "Connected" : "Disconnected"}</span>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleSubscribe}
          disabled={!isConnected || isSubscribed}
        >
          Subscribe
        </Button>
        <Button
          onClick={handleUnsubscribe}
          disabled={!isConnected || !isSubscribed}
          variant="outline"
        >
          Unsubscribe
        </Button>
      </div>
      <div className="flex flex-col items-center gap-4 p-6">
        <div className="flex w-full max-w-4xl items-center justify-between">
          <h2 className="text-2xl font-bold">Order Book Using MMT stream</h2>
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
    </div>
  );
};

export default MMTOb;
