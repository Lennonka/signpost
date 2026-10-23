import test from 'node:test';
import assert from 'node:assert/strict';
import { createExport } from '../js/config.js';

const tree = [{ id: '0', children: [{ id: '1', title: 'Bookmarks Bar', children: [
    { id: '2', title: 'Work', children: [] },
    { id: '3', url: 'https://example.com/?a=1#test' }
] }] }];
const tile = id => ({ id, x: 2, y: 3, w: 2, h: 1, backgroundColor: '#abcdef' });

test('export uses portable references, keeps duplicate URLs, settings, wallpaper and geometry', () => {
    const result = createExport({ gridColumns: 12, openInNewTab: true, unknown: 'ignored' },
        [tile('2'), tile('3'), { ...tile('4'), bookmarkSnapshot: { url: 'https://example.com/?a=1#test' } }],
        tree, 'data:image/png;base64,abc', new Date('2026-10-23T12:00:00Z'));
    assert.equal(result.version, 1);
    assert.equal(result.exportedAt, '2026-10-23T12:00:00.000Z');
    assert.equal(result.settings.gridColumns, 12);
    assert.equal(result.settings.openInNewTab, true);
    assert.equal(result.settings.desktopBackgroundImage, 'data:image/png;base64,abc');
    assert.equal(result.settings.unknown, undefined);
    assert.equal(result.settings.tileSize, undefined);
    assert.deepEqual(result.tiles[0], { type: 'folder', path: ['Bookmarks Bar', 'Work'],
        x: 2, y: 3, w: 2, h: 1, backgroundColor: '#abcdef', textColor: '' });
    assert.equal(result.tiles[1].url, 'https://example.com/?a=1#test');
    assert.deepEqual(result.tiles[1], result.tiles[2]);
    assert.ok(!JSON.stringify(result).includes('"id"'));
});

test('unidentifiable tiles fail instead of silently producing incomplete backups', () => {
    assert.throws(() => createExport({}, [tile('missing')], tree), /Cannot identify/);
    assert.deepEqual(createExport({}, [], []).tiles, []);
});
