import { DatabaseSync } from "node:sqlite";
import type { WsBook } from "./types";

export class DatabaseClient {
  private db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync("hyperliquid.db");
  }

  private serializeLevel(row: BookLevelRow): BookLevel {
    return {
      px: String(row.px),
      sz: String(row.sz),
      n: Number(row.n),
    };
  }

  private serializeBook(row: OrderBookRow, levelGroup: LevelGroup): StoredBook {
    return {
      id: Number(row.id),
      coin: String(row.coin),
      time: Number(row.ts),
      levels: [levelGroup.bids, levelGroup.asks],
    };
  }

  private hydrateBooks(rows: OrderBookRow[]): StoredBook[] {
    if (!rows.length) {
      return [];
    }

    const ids = rows.map((row) => Number(row.id));
    const placeholders = new Array(ids.length).fill("?").join(", ");
    const levelsStmt = this.db.prepare(
      `SELECT book_id, side, px, sz, n FROM book_levels WHERE book_id IN (${placeholders}) ORDER BY book_id ASC, side ASC`
    );
    const levelRows = levelsStmt.all(...ids) as BookLevelRow[];

    const levelMap = new Map<number, LevelGroup>();
    for (const id of ids) {
      levelMap.set(id, { bids: [], asks: [] });
    }

    for (const levelRow of levelRows) {
      const group = levelMap.get(Number(levelRow.book_id));
      if (!group) {
        continue;
      }

      const level = this.serializeLevel(levelRow);
      if (levelRow.side === "bid") {
        group.bids.push(level);
      } else if (levelRow.side === "ask") {
        group.asks.push(level);
      }
    }

    return rows.map((row) =>
      this.serializeBook(
        row,
        levelMap.get(Number(row.id)) ?? { bids: [], asks: [] }
      )
    );
  }

  boostrapTables() {
    const orderBookTable = `
        CREATE TABLE IF NOT EXISTS order_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            ts BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS book_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INT NOT NULL REFERENCES order_books(id) ON DELETE CASCADE,
            side TEXT NOT NULL CHECK (side IN ('bid', 'ask')),
            px TEXT NOT NULL,
            sz TEXT NOT NULL,
            n INT NOT NULL
        );
    `;

    this.db.exec(orderBookTable);
  }

  saveL2Book(book: WsBook) {
    const insertBookStmt = this.db.prepare(
      `INSERT INTO order_books (coin, ts) VALUES (?, ?)`
    );

    const result = insertBookStmt.run(book.coin, book.time);
    const bookId = result.lastInsertRowid as number;

    const insertLevelStmt = this.db.prepare(
      `INSERT INTO book_levels (book_id, side, px, sz, n) VALUES (?, ?, ?, ?, ?)`
    );

    const [bids, asks] = book.levels;

    const insertLevelsTx = () => {
      this.db.exec("BEGIN TRANSACTION");
      try {
        for (const level of bids) {
          insertLevelStmt.run(bookId, "bid", level.px, level.sz, level.n);
        }
        for (const level of asks) {
          insertLevelStmt.run(bookId, "ask", level.px, level.sz, level.n);
        }

        this.db.exec("COMMIT");
      } catch (err) {
        console.error("Failed to insert book levels:", err);
        this.db.exec("ROLLBACK");
      }
    };

    insertLevelsTx();
  }

  close() {
    this.db.close();
  }

  getOrderBookById(id: number) {
    const bookStmt = this.db.prepare(
      `SELECT id, coin, ts FROM order_books WHERE id = ?`
    );
    const bookRow = bookStmt.get(id) as OrderBookRow | undefined;
    if (!bookRow) {
      return null;
    }

    const [book] = this.hydrateBooks([bookRow]);
    return book ?? null;
  }

  getLatestOrderBook(coin: string) {
    const latestBookStmt = this.db.prepare(
      `SELECT id, coin, ts FROM order_books WHERE coin = ? ORDER BY ts DESC LIMIT 1`
    );
    const bookRow = latestBookStmt.get(coin) as OrderBookRow | undefined;
    if (!bookRow) {
      return null;
    }

    const [book] = this.hydrateBooks([bookRow]);
    return book ?? null;
  }

  getOrderBooksByCoin(coin: string, limit: number = 10) {
    const booksStmt = this.db.prepare(
      `SELECT id, coin, ts FROM order_books WHERE coin = ? ORDER BY ts DESC LIMIT ?`
    );
    const bookRows = booksStmt.all(coin, limit) as OrderBookRow[];
    return this.hydrateBooks(bookRows);
  }

  getBookLevelsByBookId(bookId: number) {
    const levelsStmt = this.db.prepare(
      `SELECT book_id, side, px, sz, n FROM book_levels WHERE book_id = ?`
    );
    const rows = levelsStmt.all(bookId) as BookLevelRow[];
    return rows.map((row) => ({
      side: row.side,
      ...this.serializeLevel(row),
    }));
  }

  getAllOrderBooks(limit: number = 10, timestamp?: number) {
    let booksStmt;
    let params: Array<number> = [limit];
    if (typeof timestamp === "number") {
      booksStmt = this.db.prepare(
        `SELECT id, coin, ts FROM order_books WHERE ts >= ? ORDER BY ts DESC LIMIT ?`
      );
      params = [timestamp, limit];
    } else {
      booksStmt = this.db.prepare(
        `SELECT id, coin, ts FROM order_books ORDER BY ts DESC LIMIT ?`
      );
    }

    const bookRows = booksStmt.all(...params) as OrderBookRow[];
    return this.hydrateBooks(bookRows);
  }
}

type LevelSide = "bid" | "ask";

type BookLevelRow = {
  book_id: number;
  side: LevelSide;
  px: string;
  sz: string;
  n: number;
};

type OrderBookRow = {
  id: number;
  coin: string;
  ts: number;
};

type BookLevel = {
  px: string;
  sz: string;
  n: number;
};

type LevelGroup = {
  bids: BookLevel[];
  asks: BookLevel[];
};

type StoredBook = WsBook & { id: number };

/*
export interface WsBook {
  coin: string;
  levels: [Array<WsLevel>, Array<WsLevel>];
  time: number;
}
*/
