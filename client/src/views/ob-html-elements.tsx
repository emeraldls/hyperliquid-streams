import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import OrderBookPanel from "@/components/OrderBookPanel";
import { fetchOrderBook, type WsBook } from "@/lib/api";
import { useOrderBookStream } from "@/lib/hooks/useOrderBookStream";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_SYMBOL = "BTC";
const SYMBOL_OPTIONS = ["BTC", "ETH", "SOL", "ADA", "BNB"] as const;
type SymbolTicker = (typeof SYMBOL_OPTIONS)[number];

const OrderbookWithHtmlElement = () => {
  const [symbol, setSymbol] = useState<SymbolTicker>(DEFAULT_SYMBOL);
  const [liveBook, setLiveBook] = useState<WsBook | undefined>();

  const {
    data: books,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<WsBook[]>({
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

  const handleSymbolChange = (value: SymbolTicker) => {
    setLiveBook(undefined);
    setSymbol(value);
  };

  const lastSnapshot = useMemo(() => books?.[0], [books]);
  const activeBook = liveBook ?? lastSnapshot;
  const normalizedError = error instanceof Error ? error : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">
            Hyperliquid Order book ({symbol})
          </h1>
        </div>
        <Select
          value={symbol}
          onValueChange={(value) => handleSymbolChange(value as SymbolTicker)}
        >
          <SelectTrigger className="w-32  text-left text-sm">
            <SelectValue placeholder="Symbol" />
          </SelectTrigger>
          <SelectContent className="">
            {SYMBOL_OPTIONS.map((option) => (
              <SelectItem
                key={option}
                value={option}
                className="text-sm"
                disabled={option !== "BTC"}
              >
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {/* <DataCacheApp /> */}

      <OrderBookPanel
        symbol={symbol}
        book={activeBook}
        isLoading={isLoading}
        isRefreshing={isFetching}
        error={normalizedError}
        onRefresh={() => {
          void refetch();
        }}
      />
    </main>
  );
};

export default OrderbookWithHtmlElement;
