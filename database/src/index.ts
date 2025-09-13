export { db, SqliteDatabase } from './db.js';
export { migrationRunner } from './migrations.js';

export async function initializeDatabase(): Promise<void> {
  await migrationRunner.runMigrations();
}

