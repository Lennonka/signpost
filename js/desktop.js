import { DEFAULT_GRID_COLUMNS, getDefaultTileSize, createBookmarkSnapshot, getBookmarkFromTileSnapshot } from './model.js';
import { getBookmarkIndex } from './bookmarks.js';
import { storageGet } from './storage.js';
import { createLayoutWriter } from './layout-client.js';
import { bindTileActions } from './tile-actions.js';

export function createDesktop({ renderer, globalSettings, showBubbleMessage, handleEmpty, onExternalTilesAdded = () => {} }) {
    const { applyTileBackground, applyFolderTitleColor, applyBookmarkLinkTextColor, buildTileHTML } = renderer;
    // Set how content is applied to widgets
    GridStack.renderCB = function (el, w) {
        el.innerHTML = w.content || '';
        applyTileBackground(el, w.backgroundColor);
        if (el.querySelector('.folder-tile')) {
            applyFolderTitleColor(el, w.textColor);
        } else {
            applyBookmarkLinkTextColor(el, w.textColor);
        }
    };
    const gridOptions = {
        column: DEFAULT_GRID_COLUMNS,
        float: true,
        margin: 6,
        minRow: 5,
        cellHeight: 'auto',
        alwaysShowResizeHandle: false
    };
    const grid = GridStack.init(gridOptions);
    let suppressLayoutSave = false;
    let initialLayoutLoaded = false;
    const unresolvedTiles = new Map();
    const layoutWriter = createLayoutWriter();
    let layoutReady = false;
    const externalAdditions = new Map();
    // Save layout on changes
    grid.on('change', saveLayout);

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.configRevision) {
            suppressLayoutSave = true;
            location.reload();
            return;
        }
        if (areaName !== 'local' || !changes.tiles) return;
        const tiles = Array.isArray(changes.tiles.newValue) ? changes.tiles.newValue : [];
        const previousIds = new Set((changes.tiles.oldValue || []).map(tile => String(tile.id)));
        const currentIds = new Set(tiles.map(tile => String(tile.id)));
        for (const tile of tiles) {
            if (!previousIds.has(String(tile.id))) externalAdditions.set(String(tile.id), tile);
        }
        for (const id of externalAdditions.keys()) {
            if (!currentIds.has(id)) externalAdditions.delete(id);
        }
        applyExternalAdditions();
    });

    function applyExternalAdditions() {
        if (!layoutReady || suppressLayoutSave || !externalAdditions.size) return;
        const additions = [...externalAdditions.values()].filter(tile => !findGridNodeById(tile.id));
        externalAdditions.clear();
        if (!additions.length) return;

        suppressLayoutSave = true;
        grid.batchUpdate();
        try {
            for (const tile of additions) {
                const bookmark = getBookmarkFromTileSnapshot(tile);
                if (bookmark) addTileToGrid(bookmark, tile);
                else unresolvedTiles.set(String(tile.id), tile);
            }
        } finally {
            grid.batchUpdate(false);
            suppressLayoutSave = false;
        }
        // Treat received records as already saved, so later edits and removals
        // are patches rather than attempts to create the tiles again.
        layoutWriter.acceptExternalTiles(additions);
        saveLayout();
        onExternalTilesAdded();
    }


    function findGridNodeById(id) {
        return grid.getGridItems()
            .map(item => item.gridstackNode)
            .find(node => node?.id === String(id));
    }

    function getGridNode(tileEl) {
        return tileEl?.gridstackNode;
    }

    function updateTileInGrid(tileEl, bookmark, pos) {
        const node = getGridNode(tileEl);
        const tileHTML = buildTileHTML(bookmark);
        const content = tileEl.querySelector('.grid-stack-item-content') || tileEl;
        content.innerHTML = tileHTML;

        if (node) {
            node.content = tileHTML;
            node.bookmarkSnapshot = createBookmarkSnapshot(bookmark);
        }

        applyTileBackground(tileEl, node?.backgroundColor || pos?.backgroundColor);
        if (!bookmark.url) {
            applyFolderTitleColor(tileEl, node?.textColor || pos?.textColor);
        } else {
            applyBookmarkLinkTextColor(tileEl, node?.textColor || pos?.textColor);
        }
    }

    async function refreshTileFromBookmarks(tile, bookmarks) {
        const bookmark = bookmarks.get(String(tile.id));
        unresolvedTiles.delete(String(tile.id));
        const existingNode = findGridNodeById(tile.id);
        if (!bookmark) {
            if (existingNode?.el) grid.removeWidget(existingNode.el);
            return;
        }

        if (existingNode?.el) {
            updateTileInGrid(existingNode.el, bookmark, tile);
        } else {
            addTileToGrid(bookmark, tile);
        }
    }

    async function loadInitialLayout() {
        if (initialLayoutLoaded) return;
        initialLayoutLoaded = true;
        const { tiles, setupComplete } = await storageGet({ tiles: [], setupComplete: false });
        const savedTiles = Array.isArray(tiles) ? tiles : [];
        layoutWriter.initialize(savedTiles);
        layoutReady = true;
        if (savedTiles.length) await renderTiles(savedTiles);
        else handleEmpty(setupComplete);
        applyExternalAdditions();
    }

    async function renderTiles(tiles) {
        const tileList = Array.isArray(tiles) ? tiles : [];
        tileList.forEach(tile => unresolvedTiles.set(String(tile.id), tile));
        suppressLayoutSave = true;

        try {
            grid.batchUpdate();
            try {
                tileList.forEach(tile => {
                    const cachedBookmark = getBookmarkFromTileSnapshot(tile);
                    if (cachedBookmark) {
                        addTileToGrid(cachedBookmark, tile);
                        unresolvedTiles.delete(String(tile.id));
                    }
                });
            } finally {
                grid.batchUpdate(false);
            }

            const bookmarks = await getBookmarkIndex();
            const results = await Promise.allSettled(tileList.map(tile => refreshTileFromBookmarks(tile, bookmarks)));
            results.forEach(result => {
                if (result.status === 'rejected') {
                    console.warn('Could not refresh a bookmark; keeping its saved tile.', result.reason);
                }
            });
        } catch (error) {
            console.warn('Could not refresh bookmarks; keeping the saved layout.', error);
        } finally {
            suppressLayoutSave = false;
            applyExternalAdditions();
            saveLayout();
        }
    }

    function saveLayout() {
        if (!layoutReady || suppressLayoutSave || grid.isIgnoreChangeCB()) return;

        return layoutWriter.save(getLayout());
    }

    function getLayout() {
        const layout = grid.getGridItems().map(item => {
            const node = item.gridstackNode;
            return {
                x: node.x,
                y: node.y,
                w: node.w,
                h: node.h,
                id: node.id,
                backgroundColor: node.backgroundColor || '',
                textColor: node.textColor || '',
                bookmarkSnapshot: node.bookmarkSnapshot || null
            };
        });
        // Legacy tiles without snapshots cannot render when bookmark reads fail.
        // Keep their stored records until a successful lookup resolves them.
        const visibleIds = new Set(layout.map(tile => String(tile.id)));
        const unresolved = [...unresolvedTiles.values()].filter(tile => !visibleIds.has(String(tile.id)));
        return [...layout, ...unresolved];
    }

    function canPlaceTileAt(x, y, size) {
        return x >= 0 &&
            y >= 0 &&
            x + size.w <= grid.getColumn() &&
            grid.isAreaEmpty(x, y, size.w, size.h);
    }

    function findFirstEmptyTilePosition(size) {
        const gridWidth = grid.getColumn();
        const lastPossibleX = gridWidth - size.w;
        const maxRowsToSearch = Math.max(100, grid.getRow() + 100);

        for (let y = 0; y < maxRowsToSearch; y++) {
            for (let x = 0; x <= lastPossibleX; x++) {
                if (grid.isAreaEmpty(x, y, size.w, size.h)) {
                    return { x, y, w: size.w, h: size.h };
                }
            }
        }

        return { x: 0, y: grid.getRow(), w: size.w, h: size.h };
    }

    function findChildFolderTilePosition(parentNode, bookmark) {
        const size = getDefaultTileSize(bookmark);
        if (!parentNode) return findFirstEmptyTilePosition(size);

        const gridWidth = grid.getColumn();
        const rightX = parentNode.x + parentNode.w;
        if (canPlaceTileAt(rightX, parentNode.y, size)) {
            return { x: rightX, y: parentNode.y, w: size.w, h: size.h };
        }

        const belowX = Math.min(parentNode.x, Math.max(0, gridWidth - size.w));
        const belowY = parentNode.y + parentNode.h;
        if (canPlaceTileAt(belowX, belowY, size)) {
            return { x: belowX, y: belowY, w: size.w, h: size.h };
        }

        return findFirstEmptyTilePosition(size);
    }

    function addTileToGrid(bookmark, pos) {
        // Check the widget isn't in the grid yet
        const existingNode = findGridNodeById(bookmark.id);
        if (existingNode) {
            showBubbleMessage("Tile already present!");
            const tileEl = existingNode.el;
            if (tileEl) {
                tileEl.classList.add('widget-flash');
                tileEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => tileEl.classList.remove('widget-flash'), 1000);
            }

            return;
        }

        // Calculate position for new widgets
        if (!pos) {
            pos = findFirstEmptyTilePosition(getDefaultTileSize(bookmark));
        }

        // Compose tile HTML content
        const tileHTML = buildTileHTML(bookmark);

        const widget = grid.addWidget({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            content: tileHTML,
            id: `${bookmark.id}`,
            backgroundColor: pos?.backgroundColor || '',
            textColor: pos?.textColor || '',
            bookmarkSnapshot: createBookmarkSnapshot(bookmark)
        });

        if (!widget) return;

        requestAnimationFrame(() => {
            applyTileBackground(widget, pos?.backgroundColor);
            if (!bookmark.url) {
                applyFolderTitleColor(widget, pos?.textColor);
            } else {
                applyBookmarkLinkTextColor(widget, pos?.textColor);
            }
        });


        saveLayout(); // Save every time a new tile is added
    }

    function applyTileTransparencyToAllTiles() {
        grid.getGridItems().forEach(item => {
            applyTileBackground(item, item.gridstackNode?.backgroundColor);
        });
    }

    function applyDefaultLinkTextColorToBookmarkTiles() {
        grid.getGridItems().forEach(item => {
            const node = getGridNode(item);
            if (!node?.textColor) {
                applyBookmarkLinkTextColor(item);
            }
        });
    }

    function importBookmarks(children) {
        suppressLayoutSave = true;
        grid.batchUpdate();
        try {
            children.forEach(child => addTileToGrid(child));
        } finally {
            grid.batchUpdate(false);
            suppressLayoutSave = false;
        }
        saveLayout();
    }

    bindTileActions({ grid, globalSettings, renderer, saveLayout, addTileToGrid, findChildFolderTilePosition });
    return { grid, getLayout, loadInitialLayout, addTileToGrid, saveLayout, importBookmarks,
        applyTileTransparencyToAllTiles, applyDefaultLinkTextColorToBookmarkTiles };
}
