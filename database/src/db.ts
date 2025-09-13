import Database from 'better-sqlite3';
import { resolvePackagePath } from './paths.js';

export class SqliteDatabase {
  private static instance: SqliteDatabase | null = null;
  private db: Database.Database;

  private constructor() {
    const dbPath = resolvePackagePath('drifellascape.db');
    this.db = new Database(dbPath);
    this.applyPragmas();
  }

  static getInstance(): SqliteDatabase {
    if (!this.instance) this.instance = new SqliteDatabase();
    return this.instance;
  }

  private applyPragmas() {
    // Enable WAL for concurrent reads, tune sync, enforce FK, and avoid busy loops.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  prepare<T extends any[]>(sql: string) {
    return this.db.prepare(sql) as unknown as Database.Statement<T>;
  }

  get raw() {
    return this.db;
  }
}

export const db = SqliteDatabase.getInstance();

