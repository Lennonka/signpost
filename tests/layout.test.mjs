import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLayoutChanges, mutateLayout } from '../js/layout-store.js';
import { createLayoutWriter } from '../js/layout-client.js';

function fixture(tiles) {
    const state = { tiles: structuredClone(tiles), globalSettings: {} };
    let failNextWrite = false;
    globalThis.chrome = {
        runtime: {
            sendMessage(message, callback) {
                applyLayoutChanges(message).then(callback, error => callback({ ok: false, error: error.message }));
            }
        },
        storage: { local: {
            get(defaults, callback) { setTimeout(() => callback(structuredClone({ ...defaults, ...state })), 1); },
            set(data, callback) {
                setTimeout(() => {
                    if (failNextWrite) {
                        failNextWrite = false;
                        chrome.runtime.lastError = { message: 'Storage unavailable' };
                        callback();
                        delete chrome.runtime.lastError;
                    } else {
                        Object.assign(state, structuredClone(data));
                        callback();
                    }
                }, 1);
            }
        } }
    };
    return { state, failWrite: () => { failNextWrite = true; } };
}

const tile = { id: '10', x: 0, y: 0, w: 1, h: 1, backgroundColor: '', textColor: '' };

test('simultaneous additions read the latest layout inside the worker queue', async () => {
    const { state } = fixture([]);
    await Promise.all(['a', 'b', 'c'].map(id => mutateLayout(tiles => ({
        data: { tiles: [...tiles, { ...tile, id }] }, value: id
    }))));
    assert.deepEqual(state.tiles.map(tile => tile.id), ['a', 'b', 'c']);
});

test('stale desktops preserve independently saved positions, colors, and popup additions', async () => {
    const { state } = fixture([tile]);
    const first = createLayoutWriter();
    const second = createLayoutWriter();
    first.initialize([tile]);
    second.initialize([tile]);
    await applyLayoutChanges({ updates: [{ id: 'popup', isNew: true, changes: { ...tile, id: 'popup' } }] });
    await Promise.all([
        first.save([{ ...tile, x: 5 }]),
        second.save([{ ...tile, backgroundColor: '#ff0000' }])
    ]);
    assert.equal(state.tiles.find(tile => tile.id === '10').x, 5);
    assert.equal(state.tiles.find(tile => tile.id === '10').backgroundColor, '#ff0000');
    assert.ok(state.tiles.some(tile => tile.id === 'popup'));
});

test('an edit in a stale desktop cannot recreate a removed tile', async () => {
    const { state } = fixture([tile]);
    const stale = createLayoutWriter();
    stale.initialize([tile]);
    await applyLayoutChanges({ removedIds: ['10'] });
    await stale.save([{ ...tile, textColor: '#123456' }]);
    assert.deepEqual(state.tiles, []);
});

test('worker queue recovers after a failed write', async () => {
    const { state, failWrite } = fixture([tile]);
    failWrite();
    await assert.rejects(applyLayoutChanges({ removedIds: ['10'] }), /Storage unavailable/);
    await applyLayoutChanges({ updates: [{ id: '10', changes: { x: 2 } }] });
    assert.equal(state.tiles[0].x, 2);
});

test('rapid saves from one desktop preserve their order', async () => {
    const { state } = fixture([tile]);
    const writer = createLayoutWriter();
    writer.initialize([tile]);
    await Promise.all([1, 2, 3].map(x => writer.save([{ ...tile, x }])));
    assert.equal(state.tiles[0].x, 3);
});


test('received external additions can be removed without being recreated', async () => {
    const external = { ...tile, id: 'external' };
    const { state } = fixture([tile, external]);
    const writer = createLayoutWriter();
    writer.initialize([tile]);
    await writer.acceptExternalTiles([external]);
    await writer.save([tile]);
    assert.deepEqual(state.tiles.map(tile => tile.id), ['10']);
});
