import { getActiveVersionId, loadActiveSnapshotConsistent } from "./repo.js";
import type { ListingsSnapshot } from "./types.js";

export class ListingsCache {
    private current: ListingsSnapshot | null = null;
    private refreshing = false;

    async ensureLoaded(): Promise<ListingsSnapshot> {
        if (this.current) return this.current;
        this.current = loadActiveSnapshotConsistent();
        return this.current;
    }

    async refreshIfChanged(): Promise<boolean> {
        if (this.refreshing) return false;
        this.refreshing = true;
        try {
            const vid = getActiveVersionId();
            if (!vid) return false;
            if (this.current && this.current.versionId === vid) return false;
            this.current = loadActiveSnapshotConsistent();
            return true;
        } finally {
            this.refreshing = false;
        }
    }
}
