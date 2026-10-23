import { storageGet, storageSet } from './storage.js';

// Every layout mutation in the worker joins the same queue. Read inside the
// queue so each operation sees the result of the preceding write.
let pending = Promise.resolve();
export function mutateLayout(mutate) {
    const operation = pending.then(async () => {
        const data = await storageGet({ tiles: [], globalSettings: {} });
        const tiles = Array.isArray(data.tiles) ? data.tiles : [];
        const result = mutate(tiles, data.globalSettings);
        if (result.data) await storageSet(result.data);
        return result.value;
    });
    pending = operation.catch(() => {});
    return operation;
}

export function applyLayoutChanges({ updates = [], removedIds = [] }) {
    return mutateLayout(tiles => {
        const removed = new Set(removedIds.map(String));
        const byId = new Map(tiles.filter(tile => !removed.has(String(tile.id))).map(tile => [String(tile.id), tile]));
        for (const update of updates) {
            const id = String(update.id);
            // An edit from a stale tab must not recreate a removed tile.
            if (!byId.has(id) && !update.isNew) continue;
            byId.set(id, { ...byId.get(id), ...update.changes, id });
        }
        return { data: { tiles: [...byId.values()] }, value: { ok: true } };
    });
}
