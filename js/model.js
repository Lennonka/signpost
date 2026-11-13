export const FALLBACK_TILE_BACKGROUND_COLOR = '#dbdbdb';
export const DEFAULT_FOLDER_TITLE_COLOR = '#000000';
export const DEFAULT_LINK_TEXT_COLOR = '#0000ee';
export const DEFAULT_DESKTOP_TEXT_SIZE = 14;
export const MIN_DESKTOP_TEXT_SIZE = 8;
export const MAX_DESKTOP_TEXT_SIZE = 24;
export const DEFAULT_GRID_COLUMNS = 18;
export const MIN_GRID_COLUMNS = 6;
export const MAX_GRID_COLUMNS = 36;

export const defaultSettings = {
    openInNewTab: false,
    confirmBeforeRemove: false,
    tileSize: 140,
    gridColumns: DEFAULT_GRID_COLUMNS,
    desktopBackgroundColor: '#ffffff',
    desktopBackgroundOverlay: 'solid',
    desktopBackgroundDirection: 'to bottom',
    desktopBackgroundEndColor: '#000000',
    desktopBackgroundTransparency: 50,
    desktopTextSize: DEFAULT_DESKTOP_TEXT_SIZE,
    defaultTileBackgroundColor: FALLBACK_TILE_BACKGROUND_COLOR,
    defaultLinkTextColor: DEFAULT_LINK_TEXT_COLOR,
    defaultFolderTitleColor: DEFAULT_FOLDER_TITLE_COLOR,
    desktopBackgroundImage: null,
    tileBackgroundTransparency: 50,
    alwaysShowResizeHandle: false,
    alwaysShowMenuIcon: false
};

export function normalizeGridColumns(value) {
    const columns = Number.parseInt(value, 10);
    if (!Number.isFinite(columns)) return DEFAULT_GRID_COLUMNS;
    return Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, columns));
}

export function normalizeDesktopTextSize(value) {
    const textSize = Number.parseInt(value, 10);
    if (!Number.isFinite(textSize)) return DEFAULT_DESKTOP_TEXT_SIZE;
    return Math.min(MAX_DESKTOP_TEXT_SIZE, Math.max(MIN_DESKTOP_TEXT_SIZE, textSize));
}

export function createBookmarkSnapshot(bookmark) {
    const isFolder = !bookmark.url;
    return {
        id: String(bookmark.id),
        title: bookmark.title || '',
        url: bookmark.url || '',
        isFolder,
        children: isFolder ? (bookmark.children || []).map(child => ({
            id: String(child.id),
            title: child.title || '',
            url: child.url || '',
            isFolder: !child.url
        })) : []
    };
}

export function getBookmarkFromTileSnapshot(tile) {
    const snapshot = tile?.bookmarkSnapshot;
    if (!snapshot) return null;

    const id = snapshot.id || tile.id;
    if (!id) return null;

    const isFolder = Boolean(snapshot.isFolder);
    return {
        id: String(id),
        title: snapshot.title || (isFolder ? 'Untitled folder' : 'Untitled bookmark'),
        url: isFolder ? undefined : snapshot.url,
        children: isFolder ? (snapshot.children || []).map(child => ({
            id: String(child.id),
            title: child.title || (child.isFolder ? 'Untitled folder' : 'Untitled bookmark'),
            url: child.isFolder ? undefined : child.url
        })) : []
    };
}

export function getDefaultTileSize(bookmark) {
    return bookmark?.url ? { w: 1, h: 1 } : { w: 2, h: 2 };
}
