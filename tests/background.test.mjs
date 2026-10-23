import test from 'node:test';
import assert from 'node:assert/strict';

let onMessage;
const event = () => ({ addListener() {} });
const state = { tiles: [], globalSettings: { gridColumns: 6 } };
const bookmarks = [
    { id: '10', title: 'First', url: 'https://first.example/' },
    { id: '20', title: 'Second', url: 'https://second.example/' }
];
globalThis.chrome = {
    runtime: {
        onInstalled: event(), onStartup: event(),
        onMessage: { addListener(listener) { onMessage = listener; } }
    },
    contextMenus: { onClicked: event() },
    tabs: { onActivated: event(), onUpdated: event() },
    bookmarks: {
        onCreated: event(), onRemoved: event(), onChanged: event(),
        search(query, callback) { callback(bookmarks.filter(bookmark => bookmark.url === query.url)); }
    },
    storage: {
        onChanged: event(),
        local: {
            get(defaults, callback) { setTimeout(() => callback(structuredClone({ ...defaults, ...state })), 1); },
            set(data, callback) { Object.assign(state, structuredClone(data)); callback(); }
        },
        session: {
            get(defaults, callback) { callback(defaults); },
            set(data, callback) { callback(); }
        }
    }
};
await import('../background.js');
function message(data) {
    return new Promise(resolve => assert.equal(onMessage(data, {}, resolve), true));
}

test('module worker handles concurrent popup additions without overlapping or losing tiles', async () => {
    const responses = await Promise.all(bookmarks.map(bookmark => message({
        type: 'add-current-tab-to-signpost', tab: { url: bookmark.url, title: bookmark.title }
    })));
    assert.ok(responses.every(response => response.ok && response.addedTile));
    assert.deepEqual(state.tiles.map(tile => tile.id), ['10', '20']);
    assert.deepEqual(state.tiles.map(tile => tile.x), [0, 1]);
    assert.equal(state.setupComplete, true);
    const duplicate = await message({ type: 'add-current-tab-to-signpost', tab: { url: bookmarks[0].url } });
    assert.equal(duplicate.alreadyPresent, true);
    assert.equal(state.tiles.length, 2);
});

test('module worker accepts desktop changes and rejects unsupported page URLs', async () => {
    assert.equal((await message({ type: 'update-signpost-layout', updates: [{ id: '10', changes: { textColor: '#123456' } }] })).ok, true);
    assert.equal(state.tiles.find(tile => tile.id === '10').textColor, '#123456');
    const invalid = await message({ type: 'add-current-tab-to-signpost', tab: { url: 'chrome://newtab/' } });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /Only web pages/);
    assert.equal(onMessage({ type: 'unknown' }, {}, () => {}), false);
});
