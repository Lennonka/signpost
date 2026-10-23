import { chromeCall } from './chrome-api.js';

export const bookmarksSearch = query => chromeCall(chrome.bookmarks, 'search', query);
export const bookmarksGetChildren = id => chromeCall(chrome.bookmarks, 'getChildren', String(id));
export const bookmarksCreate = bookmark => chromeCall(chrome.bookmarks, 'create', bookmark);
export const bookmarksGetTree = () => chromeCall(chrome.bookmarks, 'getTree');
export const bookmarksGetSubTree = id => chromeCall(chrome.bookmarks, 'getSubTree', String(id));

export async function getBookmarkIndex() {
    const roots = await bookmarksGetTree();
    const index = new Map();
    function visit(node) {
        index.set(String(node.id), node);
        (node.children || []).forEach(visit);
    }
    roots.forEach(visit);
    return index;
}
