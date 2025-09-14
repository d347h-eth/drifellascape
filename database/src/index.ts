export { db, setDbPath } from "./db.js";
export { migrationRunner } from "./migrations.js";

import { migrationRunner as _migrationRunner } from "./migrations.js";

export async function initializeDatabase(): Promise<void> {
    await _migrationRunner.runMigrations();
}
