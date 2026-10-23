import { bookmarksGetTree } from './bookmarks.js';
import { storageGet } from './storage.js';
import { defaultSettings } from './model.js';

export function createExport(settings, tiles, bookmarkTree, backgroundImage = null, now = new Date()) {
    const references = new Map();
    function visit(node, path) {
        const folderPath = node.id === '0' ? path : [...path, node.title || ''];
        references.set(String(node.id), node.url
            ? { type: 'bookmark', url: node.url }
            : { type: 'folder', path: folderPath });
        (node.children || []).forEach(child => visit(child, folderPath));
    }
    bookmarkTree.forEach(node => visit(node, []));
    const exportedSettings = Object.fromEntries(Object.entries(defaultSettings)
        .filter(([key]) => key !== 'tileSize' && key !== 'desktopBackgroundImage')
        .map(([key, value]) => [key, settings[key] ?? value]));
    return {
        format: 'signpost',
        version: 1,
        exportedAt: now.toISOString(),
        settings: { ...exportedSettings, desktopBackgroundImage: backgroundImage },
        tiles: tiles.map(tile => {
            const bookmark = references.get(String(tile.id)) || (tile.bookmarkSnapshot?.url
                ? { type: 'bookmark', url: tile.bookmarkSnapshot.url } : null);
            if (!bookmark) throw new Error('Cannot identify a tile for export.');
            return {
                ...bookmark,
                x: tile.x, y: tile.y, w: tile.w, h: tile.h,
                backgroundColor: tile.backgroundColor || '',
                textColor: tile.textColor || ''
            };
        })
    };
}

export async function downloadExport(settings, tiles) {
    const [tree, data] = await Promise.all([
        bookmarksGetTree(), storageGet({ desktopBackgroundImage: null })
    ]);
    const exported = createExport(settings, tiles, tree, data.desktopBackgroundImage);
    const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `signpost-${exported.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
