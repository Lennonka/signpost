import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createExport, prepareImport, validateConfig, parseConfig } from '../js/config.js';

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


test('import resolves new browser IDs, folders, settings and wallpaper', () => {
    const config = createExport({ gridColumns: 12 }, [tile('2'), tile('3')], tree);
    const moved = structuredClone(tree);
    moved[0].children[0].children[0].id = '200';
    moved[0].children[0].children[1].id = '300';
    const result = prepareImport(config, moved);
    assert.deepEqual(result.tiles.map(tile => tile.id), ['200', '300']);
    assert.equal(result.tiles[1].bookmarkSnapshot.url, config.tiles[1].url);
    assert.equal(result.globalSettings.gridColumns, 12);
    assert.equal(result.desktopBackgroundImage, null);
    assert.equal(result.setupComplete, true);
});

test('import rejects malformed settings, unsupported versions and unsafe geometry', () => {
    const config = createExport({}, [tile('3')], tree);
    for (const mutate of [c => c.version = 2, c => c.settings.openInNewTab = 'true',
        c => c.tiles[0].x = -1, c => c.tiles[0].w = 100,
        c => c.settings.desktopBackgroundImage = 'https://example.com/image',
        c => c.tiles[0].textColor = 'red', c => c.settings.extra = true]) {
        const invalid = structuredClone(config);
        mutate(invalid);
        assert.throws(() => validateConfig(invalid));
    }
    assert.throws(() => validateConfig(null));
    assert.throws(() => validateConfig({}));
});

test('missing matches and ambiguous folder paths abort; duplicate URLs use distinct bookmarks', () => {
    const config = createExport({}, [tile('3')], tree);
    assert.throws(() => prepareImport(config, []), /not found/);
    config.tiles.push(structuredClone(config.tiles[0]));
    assert.throws(() => prepareImport(config, tree), /Not enough/);
    const duplicates = structuredClone(tree);
    duplicates[0].children[0].children.push({ id: '4', url: config.tiles[0].url });
    assert.deepEqual(prepareImport(config, duplicates).tiles.map(tile => tile.id), ['3', '4']);
    const folders = createExport({}, [tile('2')], tree);
    duplicates[0].children[0].children.push({ id: '5', title: 'Work', children: [] });
    assert.throws(() => prepareImport(folders, duplicates), /Ambiguous/);
    assert.deepEqual(prepareImport(createExport({}, [], tree), tree).tiles, []);
});


test('validation reports the first problem with its field path and expected value', () => {
    const config = createExport({}, [tile('3')], tree);
    const cases = [
        [c => c.settings.gridColumns = 50, 'settings.gridColumns: expected an integer from 6 to 36; found 50.'],
        [c => delete c.tiles[0].url, 'tiles[0].url: required field is missing.'],
        [c => c.tiles[0].backgroundColor = 'red', 'tiles[0].backgroundColor: expected a hex color such as "#abcdef", or "" for the default; found "red".'],
        [c => c.version = 2, 'version: unsupported version 2; this version of Signpost supports version 1.'],
        [c => c.settings.extra = true, 'settings.extra: unknown field; remove it from the configuration.'],
        [c => c.tiles[0].x = -1, 'tiles[0].x: expected an integer of at least 0; found -1.'],
        [c => c.settings.openInNewTab = 'true', 'settings.openInNewTab: expected true or false; found "true".'],
        [c => { c.tiles[0].type = 'folder'; delete c.tiles[0].url; c.tiles[0].path = ['Work', 123]; }, 'tiles[0].path[1]: expected a folder title string; found 123.']
    ];
    for (const [mutate, message] of cases) {
        const invalid = structuredClone(config);
        mutate(invalid);
        assert.throws(() => validateConfig(invalid), { message });
    }
    assert.throws(() => validateConfig(null), { message: 'configuration: expected an object; found null.' });
    assert.throws(() => parseConfig('{'), /Invalid JSON syntax:/);
    assert.deepEqual(parseConfig(JSON.stringify(config)), config);
});

test('manual invalid import fixtures demonstrate configuration and syntax errors', () => {
    const fixture = name => readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.throws(() => parseConfig(fixture('config-invalid.json')), {
        message: 'settings.gridColumns: expected an integer from 6 to 36; found 50.'
    });
    assert.throws(() => parseConfig(fixture('config-invalid-syntax.json')), /Invalid JSON syntax:/);
});

test('overlay transparency round-trips and older backups default to 50 percent', () => {
    const config = createExport({ desktopBackgroundTransparency: 75 }, [], tree);
    assert.equal(prepareImport(config, tree).globalSettings.desktopBackgroundTransparency, 75);
    for (const invalid of [-1, 101, 50.5, '50', null]) {
        assert.throws(() => validateConfig({ ...config, settings: { ...config.settings, desktopBackgroundTransparency: invalid } }),
            /settings.desktopBackgroundTransparency: expected an integer from 0 to 100/);
    }
    delete config.settings.desktopBackgroundTransparency;
    assert.equal(prepareImport(config, tree).globalSettings.desktopBackgroundTransparency, 50);
});

test('folder title default round-trips while older backups retain black', () => {
    const config = createExport({ defaultFolderTitleColor: '#123456' }, [], tree);
    assert.equal(prepareImport(config, tree).globalSettings.defaultFolderTitleColor, '#123456');
    assert.throws(() => validateConfig({ ...config, settings: { ...config.settings, defaultFolderTitleColor: 'red' } }),
        /settings.defaultFolderTitleColor: expected a hex color/);
    delete config.settings.defaultFolderTitleColor;
    assert.equal(prepareImport(config, tree).globalSettings.defaultFolderTitleColor, '#000000');
});

test('gradient settings round-trip and older backups retain solid overlays', () => {
    const settings = { desktopBackgroundColor: '#123456', desktopBackgroundOverlay: 'gradient', desktopBackgroundDirection: 'to top left', desktopBackgroundEndColor: '#abcdef' };
    const config = createExport(settings, [], tree);
    const restored = prepareImport(config, tree).globalSettings;
    for (const [key, value] of Object.entries(settings)) assert.equal(restored[key], value);
    for (const [key, value] of [['desktopBackgroundOverlay', 'radial'], ['desktopBackgroundDirection', 'url(bad)'], ['desktopBackgroundEndColor', 'red']]) {
        assert.throws(() => validateConfig({ ...config, settings: { ...config.settings, [key]: value } }), new RegExp('settings.' + key));
    }
    for (const key of ['desktopBackgroundOverlay', 'desktopBackgroundDirection', 'desktopBackgroundEndColor']) delete config.settings[key];
    const legacy = prepareImport(config, tree).globalSettings;
    assert.equal(legacy.desktopBackgroundOverlay, 'solid');
    assert.equal(legacy.desktopBackgroundDirection, 'to bottom');
    assert.equal(legacy.desktopBackgroundEndColor, '#ffffff');
});
