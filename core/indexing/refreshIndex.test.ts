import fs from "node:fs";

import { getIndexSqlitePath } from "../util/paths";
import { SqliteDb, truncateToLastNBytes } from "./refreshIndex";

describe("truncateToLastNBytes", () => {
  it("should return full string if maxBytes greater than string byte length", () => {
    const input = "Hello World";
    const result = truncateToLastNBytes(input, 100);
    expect(result).toBe("Hello World");
  });

  it("should truncate ASCII string correctly", () => {
    const input = "Hello World";
    const result = truncateToLastNBytes(input, 5);
    expect(result).toBe("World");
  });

  it("should handle empty string", () => {
    const input = "";
    const result = truncateToLastNBytes(input, 5);
    expect(result).toBe("");
  });

  it("should handle UTF-8 characters correctly", () => {
    const input = "👋 Hello";
    // 👋 is 4 bytes, space is 1 byte
    const result = truncateToLastNBytes(input, 5);
    expect(result).toBe("Hello");
  });

  it("should handle maxBytes of 0", () => {
    const input = "Hello World";
    const result = truncateToLastNBytes(input, 0);
    expect(result).toBe("");
  });
});

describe("SqliteDb", () => {
  it("initializes the shared database once for concurrent callers", async () => {
    const connections = await Promise.all(
      Array.from({ length: 20 }, () => SqliteDb.get()),
    );

    expect(new Set(connections).size).toBe(1);
    const tables = (await connections[0].all(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )) as { name: string }[];
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["tag_catalog", "global_cache", "indexing_lock"]),
    );
  });

  it("clears index data without deleting the shared schema or lock", async () => {
    const db = await SqliteDb.get();
    await db.run(
      "INSERT INTO tag_catalog (dir, branch, artifactId, path, cacheKey, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)",
      "/workspace",
      "main",
      "chunks",
      "file.ts",
      "cache-key",
      Date.now(),
    );
    await db.run(
      "INSERT INTO indexing_lock (locked, timestamp, dirs) VALUES (?, ?, ?)",
      true,
      Date.now(),
      "/workspace",
    );

    await SqliteDb.clear();

    expect(await db.get("SELECT * FROM tag_catalog")).toBeUndefined();
    expect(
      await db.get("SELECT * FROM indexing_lock WHERE locked = ?", true),
    ).toBeDefined();
    expect(await SqliteDb.get()).toBe(db);
  });

  it("recovers a corrupt rebuildable index database", async () => {
    await SqliteDb.db?.close();
    SqliteDb.db = null;
    fs.writeFileSync(getIndexSqlitePath(), "not a sqlite database");

    const db = await SqliteDb.get();
    const integrity = (await db.get("PRAGMA integrity_check")) as {
      integrity_check: string;
    };

    expect(integrity.integrity_check).toBe("ok");
    expect(
      await db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexing_lock'",
      ),
    ).toBeDefined();
  });
});
