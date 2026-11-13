import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGridColumns, normalizeDesktopTextSize, createBookmarkSnapshot,
    getBookmarkFromTileSnapshot, getDefaultTileSize } from '../js/model.js';
import { findFirstEmptyTilePosition, areasIntersect } from '../js/placement.js';
import { normalizeSettings } from '../js/settings.js';
import { normalizeColorPickerValue, escapeHTML, colorToRgba } from '../js/colors.js';
import { createTileRenderer } from '../js/tiles.js';
import { chromeCall } from '../js/chrome-api.js';

test('settings retain saved fields while normalizing bounds and defaults', () => {
    assert.equal(normalizeGridColumns('bad'), 18);
    assert.equal(normalizeGridColumns(100), 36);
    assert.equal(normalizeGridColumns(1), 6);
    assert.equal(normalizeDesktopTextSize(undefined), 14);
    assert.equal(normalizeDesktopTextSize(2), 8);
    assert.equal(normalizeDesktopTextSize(50), 24);
    assert.deepEqual(normalizeSettings({ gridColumns: '12', openInNewTab: true }).gridColumns, 12);
    assert.equal(normalizeSettings({ openInNewTab: true }).openInNewTab, true);
    assert.equal(normalizeSettings().defaultFolderTitleColor, '#000000');
    assert.equal(normalizeSettings().tileBackgroundTransparency, 50);
    assert.equal(normalizeSettings().desktopBackgroundTransparency, 50);
    assert.equal(normalizeSettings({ desktopBackgroundTransparency: '75' }).desktopBackgroundTransparency, 75);
    assert.equal(normalizeSettings({ desktopBackgroundTransparency: 200 }).desktopBackgroundTransparency, 100);
    assert.equal(normalizeSettings({ desktopBackgroundTransparency: -1 }).desktopBackgroundTransparency, 0);
    assert.equal(normalizeSettings({ desktopBackgroundTransparency: 'bad' }).desktopBackgroundTransparency, 50);
    assert.equal(normalizeSettings(null).gridColumns, 18);
});

test('folder snapshots round-trip direct links and nested folders', () => {
    const bookmark = { id: '5', title: 'Folder', children: [
        { id: '6', title: 'Link', url: 'https://example.com/' },
        { id: '7', title: 'Nested', children: [] }
    ] };
    const snapshot = createBookmarkSnapshot(bookmark);
    assert.equal(snapshot.children[1].isFolder, true);
    const restored = getBookmarkFromTileSnapshot({ id: '5', bookmarkSnapshot: snapshot });
    assert.equal(restored.children[0].url, 'https://example.com/');
    assert.equal(restored.children[1].url, undefined);
    assert.deepEqual(getDefaultTileSize(restored), { w: 2, h: 2 });
    assert.equal(getBookmarkFromTileSnapshot({ id: 'legacy' }), null);
    assert.equal(getBookmarkFromTileSnapshot({ bookmarkSnapshot: {} }), null);
});

test('placement fills the first available position and respects edges', () => {
    const tiles = [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 1, h: 1 }];
    assert.deepEqual(findFirstEmptyTilePosition({ w: 1, h: 1 }, tiles, 3), { x: 2, y: 1, w: 1, h: 1 });
    assert.deepEqual(findFirstEmptyTilePosition({ w: 2, h: 2 }, tiles, 3), { x: 0, y: 2, w: 2, h: 2 });
    assert.equal(areasIntersect({ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }), false);
});

test('color and HTML helpers preserve supported formats and escape attributes', () => {
    assert.equal(normalizeColorPickerValue('#aBc'), '#aabbcc');
    assert.equal(normalizeColorPickerValue('red'), '');
    assert.equal(colorToRgba('#abc', 0.5), 'rgba(170, 187, 204, 0.5)');
    assert.equal(escapeHTML('<a title="x">&'), '&lt;a title=&quot;x&quot;&gt;&amp;');
});

test('tile rendering escapes bookmark data and reads current settings', () => {
    globalThis.chrome = { runtime: { getURL: path => `https://extension.test${path}` } };
    const settings = { openInNewTab: false };
    const renderer = createTileRenderer(settings);
    const bookmark = { id: '1', title: '<script>bad</script>', url: 'https://example.com/?a="b"' };
    const html = renderer.buildTileHTML(bookmark);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('target="_self"'));
    assert.ok(!html.includes('<script>'));
    settings.openInNewTab = true;
    assert.ok(renderer.buildTileHTML(bookmark).includes('target="_blank"'));
});

test('Chrome wrappers surface API failures instead of returning missing records', async () => {
    globalThis.chrome = { runtime: {} };
    const target = { get(id, callback) { callback({ id }); } };
    assert.deepEqual(await chromeCall(target, 'get', '1'), { id: '1' });
    target.get = (id, callback) => {
        chrome.runtime.lastError = { message: 'Temporary failure' };
        callback();
        delete chrome.runtime.lastError;
    };
    await assert.rejects(chromeCall(target, 'get', '1'), /Temporary failure/);
});

test('overlay settings preserve gradient choices and normalize legacy defaults', () => {
    const legacy = normalizeSettings({ desktopBackgroundColor: '#112233' });
    assert.equal(legacy.desktopBackgroundOverlay, 'solid');
    assert.equal(legacy.desktopBackgroundEndColor, '#ffffff');
    assert.equal(normalizeSettings().desktopBackgroundEndColor, '#000000');
    const gradient = normalizeSettings({ desktopBackgroundOverlay: 'gradient', desktopBackgroundDirection: 'to top right', desktopBackgroundEndColor: '#abcdef' });
    assert.equal(gradient.desktopBackgroundDirection, 'to top right');
    assert.equal(normalizeSettings({ ...gradient, desktopBackgroundOverlay: 'solid' }).desktopBackgroundEndColor, '#abcdef');
    assert.equal(normalizeSettings({ desktopBackgroundDirection: 'bad', desktopBackgroundOverlay: 'bad' }).desktopBackgroundDirection, 'to bottom');
    assert.equal(normalizeSettings({ desktopBackgroundOverlay: 'bad' }).desktopBackgroundOverlay, 'solid');
});
