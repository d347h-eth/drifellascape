import Database from "better-sqlite3";
import { resolvePackagePath } from "./paths.js";

export type BetterSqlite3Database = Database.Database;
export type BetterSqlite3Statement<TArgs extends any[] = any[]> =
    Database.Statement<TArgs>;

let currentPath = resolvePackagePath("drifellascape.db");
let currentDb: BetterSqlite3Database | null = null;

function applyPragmas(conn: BetterSqlite3Database) {
    // Enable WAL for concurrent reads, tune sync, enforce FK, and avoid busy loops.
    conn.pragma("journal_mode = WAL");
    conn.pragma("synchronous = NORMAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("busy_timeout = 5000");
}

function ensureConnection(): BetterSqlite3Database {
    if (!currentDb) {
        const db = new Database(currentPath);
        applyPragmas(db);
        currentDb = db;
    }
    return currentDb;
}

export function setDbPath(newPath: string): void {
    if (currentDb) {
        try {
            currentDb.close();
        } catch {}
        currentDb = null;
    }
    currentPath = newPath;
}

export const db = {
    exec(sql: string): void {
        ensureConnection().exec(sql);
    },
    prepare<T extends any[]>(sql: string): BetterSqlite3Statement<T> {
        return ensureConnection().prepare(
            sql,
        ) as unknown as Database.Statement<T>;
    },
    get raw(): BetterSqlite3Database {
        return ensureConnection();
    },
};
