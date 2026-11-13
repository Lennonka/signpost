import { bookmarksGetTree } from './bookmarks.js';
import { storageGet } from './storage.js';
import { defaultSettings, createBookmarkSnapshot } from './model.js';

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

export function parseConfig(text) {
    let config;
    try {
        config = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON syntax: ${error.message}`);
    }
    return validateConfig(config);
}

export function validateConfig(config) {
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const describe = value => {
        const text = JSON.stringify(value) ?? 'undefined';
        return text.length > 100 ? text.slice(0, 97) + '…' : text;
    };
    const fail = (path, expected, value) => {
        throw new Error(`${path}: expected ${expected}; found ${describe(value)}.`);
    };
    const fieldPath = (path, key) => path === 'configuration' ? key : `${path}.${key}`;
    const keys = (value, allowed, path, optional = []) => {
        if (!object(value)) fail(path, 'an object', value);
        for (const key of allowed) {
            if (!optional.includes(key) && !Object.hasOwn(value, key)) throw new Error(`${fieldPath(path, key)}: required field is missing.`);
        }
        for (const key of Object.keys(value)) {
            if (!allowed.includes(key)) throw new Error(`${fieldPath(path, key)}: unknown field; remove it from the configuration.`);
        }
    };
    keys(config, ['format', 'version', 'exportedAt', 'settings', 'tiles'], 'configuration');
    if (config.format !== 'signpost') fail('format', '"signpost"', config.format);
    if (config.version !== 1) {
        throw new Error(`version: unsupported version ${describe(config.version)}; this version of Signpost supports version 1.`);
    }
    if (typeof config.exportedAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(config.exportedAt) ||
        !Number.isFinite(Date.parse(config.exportedAt))) fail('exportedAt', 'an ISO 8601 timestamp such as "2026-10-23T12:00:00.000Z"', config.exportedAt);
    const settingKeys = Object.keys(defaultSettings).filter(key => key !== 'tileSize');
    keys(config.settings, settingKeys, 'settings', ['desktopBackgroundTransparency', 'defaultFolderTitleColor']);
    const ranges = { gridColumns: [6, 36], desktopTextSize: [8, 24], tileBackgroundTransparency: [0, 100], desktopBackgroundTransparency: [0, 100] };
    const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    for (const key of settingKeys) {
        if (['desktopBackgroundTransparency', 'defaultFolderTitleColor'].includes(key) && !Object.hasOwn(config.settings, key)) continue;
        const value = config.settings[key];
        const path = `settings.${key}`;
        if (key === 'desktopBackgroundImage') {
            if (value !== null && (typeof value !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value))) {
                fail(path, 'a base64 image data URL or null', value);
            }
        } else if (ranges[key]) {
            const [min, max] = ranges[key];
            if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `an integer from ${min} to ${max}`, value);
        } else if (typeof defaultSettings[key] === 'boolean') {
            if (typeof value !== 'boolean') fail(path, 'true or false', value);
        } else if (!color(value)) {
            fail(path, 'a hex color such as "#abcdef"', value);
        }
    }
    if (!Array.isArray(config.tiles)) fail('tiles', 'an array', config.tiles);
    config.tiles.forEach((tile, index) => {
        const path = `tiles[${index}]`;
        if (!object(tile)) fail(path, 'an object', tile);
        if (!Object.hasOwn(tile, 'type')) throw new Error(`${path}.type: required field is missing.`);
        if (!['bookmark', 'folder'].includes(tile.type)) fail(`${path}.type`, '"bookmark" or "folder"', tile.type);
        keys(tile, ['type', tile.type === 'bookmark' ? 'url' : 'path', 'x', 'y', 'w', 'h', 'backgroundColor', 'textColor'], path);
        if (tile.type === 'bookmark') {
            if (typeof tile.url !== 'string' || !tile.url.length) fail(`${path}.url`, 'a nonempty URL string', tile.url);
        } else {
            if (!Array.isArray(tile.path) || !tile.path.length) fail(`${path}.path`, 'a nonempty array of folder titles', tile.path);
            tile.path.forEach((part, partIndex) => {
                if (typeof part !== 'string') fail(`${path}.path[${partIndex}]`, 'a folder title string', part);
            });
        }
        for (const key of ['x', 'y', 'w', 'h']) {
            const min = key === 'x' || key === 'y' ? 0 : 1;
            if (!Number.isSafeInteger(tile[key]) || tile[key] < min) fail(`${path}.${key}`, `an integer of at least ${min}`, tile[key]);
        }
        if (tile.x + tile.w > config.settings.gridColumns) {
            throw new Error(`${path}: x (${tile.x}) plus w (${tile.w}) exceeds settings.gridColumns (${config.settings.gridColumns}); move or resize the tile to fit.`);
        }
        for (const key of ['backgroundColor', 'textColor']) {
            if (tile[key] !== '' && !color(tile[key])) fail(`${path}.${key}`, 'a hex color such as "#abcdef", or "" for the default', tile[key]);
        }
    });
    return config;
}

export function prepareImport(config, bookmarkTree) {
    validateConfig(config);
    const references = new Map();
    function visit(node, path) {
        const next = node.id === '0' ? path : [...path, node.title || ''];
        const key = JSON.stringify(node.url ? ['bookmark', node.url] : ['folder', next]);
        if (!references.has(key)) references.set(key, []);
        references.get(key).push(node);
        (node.children || []).forEach(child => visit(child, next));
    }
    bookmarkTree.forEach(node => visit(node, []));
    const used = new Set();
    const tiles = config.tiles.map(tile => {
        const matches = references.get(JSON.stringify([tile.type, tile.type === 'bookmark' ? tile.url : tile.path])) || [];
        if (!matches.length) throw new Error(`Bookmark not found: ${tile.url || tile.path.join(' / ')}.`);
        if (tile.type === 'folder' && matches.length > 1) throw new Error(`Ambiguous folder: ${tile.path.join(' / ')}.`);
        const bookmark = matches.find(node => !used.has(String(node.id)));
        if (!bookmark) throw new Error(`Not enough matching bookmarks for: ${tile.url || tile.path.join(' / ')}.`);
        used.add(String(bookmark.id));
        return { id: String(bookmark.id), x: tile.x, y: tile.y, w: tile.w, h: tile.h,
            backgroundColor: tile.backgroundColor, textColor: tile.textColor,
            bookmarkSnapshot: createBookmarkSnapshot(bookmark) };
    });
    const { desktopBackgroundImage, ...settings } = config.settings;
    return { tiles, globalSettings: { ...defaultSettings, ...settings }, desktopBackgroundImage, setupComplete: true };
}
