import { initializeDatabase } from "@drifellascape/database";
import type { NormalizedListing, SyncResult } from "./types.js";
import { PRICE_EPSILON } from "./types.js";
import {
    activateVersion,
    cleanupNonActive,
    countDiffs,
    createInactiveVersion,
    createTempTable,
    deleteVersionCascade,
    dropTempTable,
    ensureActiveVersionId,
    insertSnapshotFromTemp,
    loadTempRows,
} from "./repo.js";

export async function syncListings(
    listings: NormalizedListing[],
): Promise<SyncResult> {
    await initializeDatabase();

    // Guard: require full set provided by caller.
    // If empty array and active snapshot also empty, no-op is fine.
    createTempTable();
    try {
        const activeId = ensureActiveVersionId();

        loadTempRows(listings);

        const { inserted, updated, deleted, total } = countDiffs(
            activeId,
            PRICE_EPSILON,
        );

        if (inserted + updated + deleted === 0) {
            return {
                changed: false,
                counts: { inserted, updated, deleted, total },
            };
        }

        const newVersionId = createInactiveVersion(total);
        const changes = insertSnapshotFromTemp(newVersionId);
        if (changes !== total) {
            deleteVersionCascade(newVersionId);
            throw new Error(
                `Snapshot insert mismatch: expected ${total}, inserted ${changes}`,
            );
        }

        activateVersion(newVersionId);
        cleanupNonActive(newVersionId);

        return {
            changed: true,
            versionId: newVersionId,
            counts: { inserted, updated, deleted, total },
        };
    } finally {
        dropTempTable();
    }
}
