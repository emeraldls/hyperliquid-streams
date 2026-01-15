import React, { useState, useEffect, useRef } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

export default function DataCacheApp() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [page, setPage] = useState(1);
  const [lastUpdate, setLastUpdate] = useState(null);
  const workerRef = useRef(null);
  const itemsPerPage = 10;

  useEffect(() => {
    const workerCode = `
      // Cache structure: { page: data, timestamp }
      const cache = new Map();
      const CACHE_TTL = 60000; // 60 seconds

      self.addEventListener('message', async (e) => {
        const { type, page, perPage } = e.data;

        if (type === 'GET_CACHE') {
          const cacheKey = page + '-' + perPage;
          const cached = cache.get(cacheKey);
          
          if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            self.postMessage({ 
              type: 'CACHE_HIT', 
              data: cached.data,
              page,
              timestamp: cached.timestamp
            });
          } else {
            self.postMessage({ type: 'CACHE_MISS', page });
          }
        }

        if (type === 'FETCH_DATA') {
          try {
            // CoinGecko API - paginated crypto data
            const response = await fetch(
              'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=' + perPage + '&page=' + page + '&sparkline=false&price_change_percentage=24h'
            );
            const json = await response.json();
            
            const cacheKey = page + '-' + perPage;
            const timestamp = Date.now();
            cache.set(cacheKey, { data: json, timestamp });
            
            self.postMessage({ 
              type: 'FETCH_SUCCESS', 
              data: json,
              page,
              timestamp
            });
          } catch (err) {
            self.postMessage({ 
              type: 'FETCH_ERROR', 
              error: err.message,
              page
            });
          }
        }

        if (type === 'CLEAR_CACHE') {
          cache.clear();
          self.postMessage({ type: 'CACHE_CLEARED' });
        }
      });
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    workerRef.current = worker;

    worker.addEventListener("message", (e) => {
      const { type, data: workerData, page: workerPage, timestamp } = e.data;

      if (type === "CACHE_HIT") {
        setData(workerData);
        setFromCache(true);
        setLoading(false);
        setLastUpdate(timestamp);
      }

      if (type === "CACHE_MISS") {
        setFromCache(false);
      }

      if (type === "FETCH_SUCCESS") {
        setData(workerData);
        setFromCache(false);
        setLoading(false);
        setLastUpdate(timestamp);
      }

      if (type === "FETCH_ERROR") {
        setLoading(false);
      }

      if (type === "CACHE_CLEARED") {
        setData([]);
        setFromCache(false);
      }
    });

    loadPage(page);

    return () => worker.terminate();
  }, []);

  const loadPage = (pageNum) => {
    if (!workerRef.current) return;

    setLoading(true);
    workerRef.current.postMessage({
      type: "GET_CACHE",
      page: pageNum,
      perPage: itemsPerPage,
    });
    workerRef.current.postMessage({
      type: "FETCH_DATA",
      page: pageNum,
      perPage: itemsPerPage,
    });
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadPage(newPage);
  };

  const handleRefresh = () => {
    loadPage(page);
  };

  const handleClearCache = () => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CLEAR_CACHE" });
    }
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(price);
  };

  const formatPercent = (percent) => {
    if (!percent) return "N/A";
    const formatted = percent.toFixed(2);
    return formatted > 0 ? `+${formatted}%` : `${formatted}%`;
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">
                Crypto Prices
              </h1>
              {lastUpdate && (
                <p className="text-sm text-gray-400">
                  {fromCache ? "⚡ From cache" : "🔄 Fresh data"} • Updated{" "}
                  {new Date(lastUpdate).toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRefresh}
                disabled={loading && !data.length}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
              <button
                onClick={handleClearCache}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Clear Cache
              </button>
            </div>
          </div>

          {loading && !data.length ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">
                        #
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">
                        Coin
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium">
                        Price
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium">
                        24h %
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium">
                        Market Cap
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((coin) => (
                      <tr
                        key={coin.id}
                        className="border-b border-gray-700 hover:bg-gray-750 transition-colors"
                      >
                        <td className="py-3 px-4 text-gray-400">
                          {coin.market_cap_rank}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={coin.image}
                              alt={coin.name}
                              className="w-8 h-8"
                            />
                            <div>
                              <div className="text-white font-medium">
                                {coin.name}
                              </div>
                              <div className="text-gray-400 text-sm uppercase">
                                {coin.symbol}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-white font-mono">
                          {formatPrice(coin.current_price)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-medium ${
                            coin.price_change_percentage_24h > 0
                              ? "text-green-500"
                              : "text-red-500"
                          }`}
                        >
                          {formatPercent(coin.price_change_percentage_24h)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-300 font-mono">
                          ${(coin.market_cap / 1e9).toFixed(2)}B
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-6">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1 || loading}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <span className="text-gray-400">Page {page}</span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
