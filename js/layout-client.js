import { chromeCall } from './chrome-api.js';

// Only send fields changed by this desktop. A stale tab must not replace
// bookmarks or appearance changes saved by another desktop or the popup.
export function createLayoutWriter() {
    let baseline = new Map();
    let pending = Promise.resolve();

    function initialize(tiles) {
        baseline = new Map(tiles.map(tile => [String(tile.id), structuredClone(tile)]));
    }

    function acceptExternalTiles(tiles) {
        const snapshot = structuredClone(tiles);
        pending = pending.then(() => {
            for (const tile of snapshot) baseline.set(String(tile.id), tile);
        });
        return pending;
    }

    function save(tiles) {
        const snapshot = structuredClone(tiles);
        const operation = pending.then(async () => {
            const next = new Map(snapshot.map(tile => [String(tile.id), tile]));
            const removedIds = [...baseline.keys()].filter(id => !next.has(id));
            const updates = [];
            for (const [id, tile] of next) {
                const previous = baseline.get(id);
                const changes = Object.fromEntries(Object.entries(tile).filter(([key, value]) =>
                    key !== 'id' && JSON.stringify(value) !== JSON.stringify(previous?.[key])));
                if (!previous || Object.keys(changes).length) updates.push({ id, changes, isNew: !previous });
            }
            if (updates.length || removedIds.length) {
                const response = await chromeCall(chrome.runtime, 'sendMessage', {
                    type: 'update-signpost-layout', updates, removedIds
                });
                if (!response?.ok) throw new Error(response?.error || 'Could not save layout.');
            }
            baseline = next;
        });
        pending = operation.catch(error => console.warn('Could not save Signpost layout.', error));
        return pending;
    }

    return { initialize, save, acceptExternalTiles };
}
