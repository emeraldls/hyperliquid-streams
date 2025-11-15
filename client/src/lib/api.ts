const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface WsLevel {
  px: string;
  sz: string;
  n: number;
}

export interface WsBook {
  coin: string;
  levels: [WsLevel[], WsLevel[]];
  time: number;
}

export interface ApiResponse<T> {
  data: T;
}

export const fetchOrderBook = async (symbol: string): Promise<WsBook[]> => {
  const params = new URLSearchParams({ symbol });
  const response = await fetch(
    `${API_BASE_URL}/api/orderbook?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Orderbook request failed with ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<WsBook[]>;
  return payload.data;
};
