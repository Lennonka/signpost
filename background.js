import { mutateLayout, applyLayoutChanges } from './js/layout-store.js';
import { createBookmarkSnapshot, normalizeGridColumns } from './js/model.js';
import { findFirstEmptyTilePosition } from './js/placement.js';
import { bookmarksSearch, bookmarksGetChildren, bookmarksCreate } from './js/bookmarks.js';
import { storageGet } from './js/storage.js';
import { chromeCall } from './js/chrome-api.js';

const tabsGet = id => chromeCall(chrome.tabs, 'get', id);
const tabsQuery = query => chromeCall(chrome.tabs, 'query', query);

const PAGE_CONTEXT_MENU_ID = 'add-page-to-signpost';
const LINK_CONTEXT_MENU_ID = 'add-link-to-signpost';
const ACTION_CONTEXT_MENU_ID = 'add-to-signpost-action';
const ADD_CONTEXT_MENU_IDS = new Set([PAGE_CONTEXT_MENU_ID, LINK_CONTEXT_MENU_ID, ACTION_CONTEXT_MENU_ID]);
const SIGNPOST_BOOKMARKS_FOLDER = 'Signpost Bookmarks';
const BOOKMARKS_BAR_ID = '1';
const WEB_PAGE_URL_PATTERNS = ['http://*/*', 'https://*/*'];
const ACTIVE_TAB_SIGNPOST_STATE_KEY = 'activeTabSignpostState';

addEventListenerIfAvailable(chrome.runtime?.onInstalled, createContextMenus);
addEventListenerIfAvailable(chrome.runtime?.onStartup, createContextMenus);
addEventListenerIfAvailable(chrome.runtime?.onInstalled, refreshCurrentActiveTabSignpostState);
addEventListenerIfAvailable(chrome.runtime?.onStartup, refreshCurrentActiveTabSignpostState);

addEventListenerIfAvailable(chrome.tabs?.onActivated, ({ tabId }) => {
    refreshActiveTabSignpostState(tabId);
});

addEventListenerIfAvailable(chrome.tabs?.onUpdated, (tabId, changeInfo, tab) => {
    if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
    refreshActiveTabSignpostState(tabId, tab);
});

addEventListenerIfAvailable(chrome.storage?.onChanged, (changes, areaName) => {
    if (areaName !== 'local' || !changes.tiles) return;
    refreshCurrentActiveTabSignpostState();
});

addEventListenerIfAvailable(chrome.bookmarks?.onCreated, refreshCurrentActiveTabSignpostState);
addEventListenerIfAvailable(chrome.bookmarks?.onRemoved, refreshCurrentActiveTabSignpostState);
addEventListenerIfAvailable(chrome.bookmarks?.onChanged, refreshCurrentActiveTabSignpostState);

function addEventListenerIfAvailable(event, listener) {
    if (typeof event?.addListener === 'function') {
        event.addListener(listener);
    }
}

function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: PAGE_CONTEXT_MENU_ID,
            title: 'Add page to Signpost',
            contexts: ['page'],
            documentUrlPatterns: WEB_PAGE_URL_PATTERNS
        });
        chrome.contextMenus.create({
            id: LINK_CONTEXT_MENU_ID,
            title: 'Add link to Signpost',
            contexts: ['link'],
            targetUrlPatterns: WEB_PAGE_URL_PATTERNS
        });
        chrome.contextMenus.create({
            id: ACTION_CONTEXT_MENU_ID,
            title: 'Add page to Signpost',
            contexts: ['action']
        });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!ADD_CONTEXT_MENU_IDS.has(info.menuItemId)) return;

    addContextClickToSignpost(info, tab)
        .then(() => showTemporaryBadge('OK', tab?.id))
        .catch((err) => {
            console.warn('Could not add current tab to Signpost.', err);
            showTemporaryBadge('ERR', tab?.id);
        });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'update-signpost-layout') {
        applyLayoutChanges(message)
            .then(() => sendResponse({ ok: true }))
            .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
    }

    if (message?.type === 'get-active-tab-signpost-state') {
        getCachedActiveTabSignpostState(message.tabId)
            .then((state) => sendResponse({ ok: true, state }))
            .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

        return true;
    }

    if (message?.type !== 'add-current-tab-to-signpost') return false;

    addTabToSignpost(message.tab)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

    return true;
});

async function addTabToSignpost(tab) {
    const site = getSiteFromTab(tab);
    const result = await addSiteToSignpost(site);
    if (tab?.id) {
        saveActiveTabSignpostState({
            tabId: tab.id,
            url: site.url,
            isOnSignpost: true
        }).catch((err) => {
            console.warn('Could not cache active tab Signpost state.', err);
        });
    }
    return result;
}

async function addContextClickToSignpost(info, tab) {
    const site = info.menuItemId === LINK_CONTEXT_MENU_ID
        ? getSiteFromLink(info.linkUrl)
        : getSiteFromTab(tab);

    return addSiteToSignpost(site);
}

async function addSiteToSignpost(site) {
    const bookmark = await getOrCreateBookmark(site);
    const tileResult = await addBookmarkTile(bookmark);

    return {
        bookmark,
        addedTile: tileResult.added,
        alreadyPresent: !tileResult.added
    };
}

async function refreshCurrentActiveTabSignpostState() {
    try {
        const tabs = await tabsQuery({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.id) await refreshActiveTabSignpostState(tab.id, tab);
    } catch (err) {
        console.warn('Could not refresh active tab Signpost state.', err);
    }
}

async function refreshActiveTabSignpostState(tabId, tab) {
    try {
        const activeTab = tab || await tabsGet(tabId);
        const site = getSiteFromTab(activeTab);
        const isOnSignpost = await hasDesktopBookmark(site.url);

        await saveActiveTabSignpostState({
            tabId,
            url: site.url,
            isOnSignpost
        });
    } catch (err) {
        await saveActiveTabSignpostState({
            tabId,
            url: '',
            isOnSignpost: false
        });
    }
}

function getCachedActiveTabSignpostState(tabId) {
    return new Promise((resolve, reject) => {
        chrome.storage.session.get({ [ACTIVE_TAB_SIGNPOST_STATE_KEY]: null }, (data) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
                return;
            }

            const state = data[ACTIVE_TAB_SIGNPOST_STATE_KEY];
            if (!state || Number(state.tabId) !== Number(tabId)) {
                resolve({ tabId, url: '', isOnSignpost: false, known: false });
                return;
            }

            resolve({ ...state, known: true });
        });
    });
}

function saveActiveTabSignpostState(state) {
    return new Promise((resolve, reject) => {
        chrome.storage.session.set({ [ACTIVE_TAB_SIGNPOST_STATE_KEY]: state }, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
        });
    });
}

async function hasDesktopBookmark(url) {
    const [bookmarks, data] = await Promise.all([
        bookmarksSearch({ url }),
        storageGet({ tiles: [] })
    ]);
    const tiles = Array.isArray(data.tiles) ? data.tiles : [];

    return bookmarks.some((bookmark) =>
        tiles.some((tile) => String(tile.id) === String(bookmark.id))
    );
}

function getSiteFromLink(linkUrl) {
    if (!linkUrl) {
        throw new Error('No link URL is available.');
    }

    const url = new URL(linkUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only web links can be added to Signpost.');
    }

    return {
        url: linkUrl,
        title: url.hostname
    };
}

function getSiteFromTab(tab) {
    if (!tab?.url) {
        throw new Error('No active tab URL is available.');
    }

    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only web pages can be added to Signpost.');
    }

    return {
        url: tab.url,
        title: tab.title || url.hostname
    };
}

async function getOrCreateSignpostFolder() {
    const children = await bookmarksGetChildren(BOOKMARKS_BAR_ID);
    const existingFolder = children.find((node) =>
        !node.url && node.title === SIGNPOST_BOOKMARKS_FOLDER
    );

    if (existingFolder) return existingFolder;

    return bookmarksCreate({
        parentId: BOOKMARKS_BAR_ID,
        title: SIGNPOST_BOOKMARKS_FOLDER
    });
}

async function getOrCreateBookmark(site) {
    const existingBookmarks = await bookmarksSearch({ url: site.url });
    if (existingBookmarks.length > 0) return existingBookmarks[0];

    const folder = await getOrCreateSignpostFolder();
    const folderId = folder.id;
    const children = await bookmarksGetChildren(folderId);
    const existingBookmark = children.find((node) => node.url === site.url);

    if (existingBookmark) return existingBookmark;

    return bookmarksCreate({
        parentId: folderId,
        title: site.title,
        url: site.url
    });
}

async function addBookmarkTile(bookmark) {
    return mutateLayout((tiles, globalSettings) => {
        const bookmarkId = String(bookmark.id);
        if (tiles.some(tile => String(tile.id) === bookmarkId)) {
            return { value: { added: false } };
        }
        const columns = normalizeGridColumns(globalSettings?.gridColumns);
        const position = findFirstEmptyTilePosition({ w: 1, h: 1 }, tiles, columns);
        const tile = {
            ...position,
            id: bookmarkId,
            backgroundColor: '',
            textColor: '',
            bookmarkSnapshot: createBookmarkSnapshot(bookmark)
        };
        return {
            data: { tiles: [...tiles, tile], setupComplete: true },
            value: { added: true }
        };
    });
}

function showTemporaryBadge(text, tabId) {
    if (!tabId) return;

    chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId });
    }, 1500);
}
