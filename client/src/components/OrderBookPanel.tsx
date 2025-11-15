import { useMemo } from "react";
import type { WsBook, WsLevel } from "../lib/api";

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIZE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

type Side = "bid" | "ask";

type OrderBookRow = {
  price: number;
  size: number;
  cumulative: number;
  depthPct: number;
};

interface OrderBookPanelProps {
  symbol: string;
  book?: WsBook;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  onRefresh: () => void;
  depth?: number;
}

const toNumber = (value: string | number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildRows = (
  levels: WsLevel[] | undefined,
  side: Side,
  depthLimit: number
): OrderBookRow[] => {
  if (!levels?.length) {
    return [];
  }

  const sortedLevels = [...levels]
    .map((level) => ({
      price: toNumber(level.px),
      size: Math.max(toNumber(level.sz), 0),
    }))
    .filter((row) => row.price > 0 && row.size > 0)
    .sort((a, b) => (side === "ask" ? a.price - b.price : b.price - a.price))
    .slice(0, depthLimit);

  const rows: OrderBookRow[] = [];
  let cumulative = 0;
  for (const row of sortedLevels) {
    cumulative += row.size;
    rows.push({ ...row, cumulative });
  }

  const maxCumulative = rows.at(-1)?.cumulative ?? 0;
  return rows.map((row) => ({
    ...row,
    depthPct:
      maxCumulative > 0
        ? Math.min((row.cumulative / maxCumulative) * 100, 100)
        : 0,
  }));
};

const formatPrice = (value: number) => PRICE_FORMATTER.format(value);
const formatSize = (value: number) => SIZE_FORMATTER.format(value);

export const OrderBookPanel = ({
  symbol,
  book,
  isLoading,
  isRefreshing,
  error,
  onRefresh,
  depth = 12,
}: OrderBookPanelProps) => {
  const { bids, asks } = useMemo(() => {
    if (!book) {
      return { bids: [], asks: [] };
    }

    const [rawBids = [], rawAsks = []] = book.levels;
    return {
      bids: buildRows(rawBids, "bid", depth),
      asks: buildRows(rawAsks, "ask", depth),
    };
  }, [book, depth]);

  const lastUpdated = book?.time
    ? new Date(book.time).toLocaleTimeString()
    : "—";

  return (
    <section className="space-y-4 rounded-xl border p-4 shadow-lg shadow-black/20">
      <header className="flex flex-wrap items-center justify-between gap-3 text-sm ">
        <div>
          <p className="text-xs uppercase tracking-wider">Live order book</p>
          <p className="text-lg font-semibold">
            {symbol} · last update {lastUpdated}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs">
            {isLoading
              ? "loading snapshot"
              : error
              ? "errored"
              : isRefreshing
              ? "refreshing"
              : "live"}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="rounded border px-3 py-1 text-xs font-medium transition disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <p className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error.message}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <OrderBookSide title="Asks" side="ask" rows={asks} />
          <OrderBookSide title="Bids" side="bid" rows={bids} />
        </div>
      )}
    </section>
  );
};

interface OrderBookSideProps {
  title: string;
  side: Side;
  rows: OrderBookRow[];
}

const OrderBookSide = ({ title, side, rows }: OrderBookSideProps) => (
  <div className="space-y-2">
    <div
      className={`text-xs uppercase tracking-widest ${
        side === "bid" ? "text-emerald-400" : "text-rose-400"
      }`}
    >
      {title}
    </div>
    <div className="flex items-center justify-between text-[0.65rem] uppercase">
      <span className="w-1/3 text-right">Price</span>
      <span className="w-1/3 text-right">Size</span>
      <span className="w-1/3 text-right">Depth</span>
    </div>
    <div className="space-y-1">
      {rows.length ? (
        rows.map((row) => (
          <DepthRow
            key={`${side}-${row.price}-${row.size}`}
            row={row}
            side={side}
          />
        ))
      ) : (
        <p className="rounded border p-3 text-center text-xs ">No data</p>
      )}
    </div>
  </div>
);

interface DepthRowProps {
  row: OrderBookRow;
  side: Side;
}

const DepthRow = ({ row, side }: DepthRowProps) => {
  const barColor = side === "bid" ? "bg-emerald-500/25" : "bg-rose-500/25";
  const anchorClass = side === "bid" ? "left-0" : "right-0";

  return (
    <div className="relative overflow-hidden rounded border px-2 py-1 text-xs font-mono">
      <div
        className={`pointer-events-none absolute inset-y-0 ${anchorClass} ${barColor}`}
        style={{ width: `${row.depthPct}%` }}
      />
      <div className="relative flex items-center gap-2">
        <span
          className={`w-1/3 text-right ${
            side === "bid" ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {formatPrice(row.price)}
        </span>
        <span className="w-1/3 text-right">{formatSize(row.size)}</span>
        <span className="w-1/3 text-right">{formatSize(row.cumulative)}</span>
      </div>
    </div>
  );
};

export default OrderBookPanel;
