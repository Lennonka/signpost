import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const mock = `
window.fixture = {
    data: {
        tiles: [
            { id: '10', x: 0, y: 0, w: 1, h: 1, backgroundColor: '#123456', textColor: '#abcdef', bookmarkSnapshot: { id: '10', title: 'Cached title', url: 'https://example.com/', isFolder: false, children: [] } },
            { id: '20', x: 1, y: 0, w: 2, h: 2, bookmarkSnapshot: { id: '20', title: 'Folder', isFolder: true, children: [] } }
        ],
        globalSettings: { gridColumns: 12 }, setupComplete: true
    },
    tree: [{ id: '0', children: [{ id: '1', title: 'Bookmarks Bar', children: [
        { id: '10', title: 'Updated title', url: 'https://example.com/' },
        { id: '20', title: 'Folder', children: [
            { id: '30', title: 'Child folder', children: [{ id: '40', title: 'Deep bookmark', url: 'https://deep.example/' }] }
        ] }
    ] }] }],
    failBookmarks: false,
    writes: []
};
const copy = value => JSON.parse(JSON.stringify(value));
const find = id => {
    const visit = node => String(node.id) === id ? node : (node.children || []).map(visit).find(Boolean);
    return fixture.tree.map(visit).find(Boolean);
};
const storageListeners = [];
fixture.externalAdd = tile => {
    const oldValue = copy(fixture.data.tiles);
    fixture.data.tiles.push(copy(tile));
    for (const listener of storageListeners) listener({ tiles: { oldValue, newValue: copy(fixture.data.tiles) } }, 'local');
};
window.chrome = {
    runtime: {
        getURL: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        sendMessage(message, callback) {
            const removed = new Set(message.removedIds);
            const byId = new Map(fixture.data.tiles.filter(tile => !removed.has(tile.id)).map(tile => [tile.id, tile]));
            for (const update of message.updates) {
                if (byId.has(update.id) || update.isNew) byId.set(update.id, { ...byId.get(update.id), ...update.changes, id: update.id });
            }
            const data = { tiles: [...byId.values()] };
            fixture.writes.push(copy(data));
            Object.assign(fixture.data, copy(data));
            setTimeout(() => callback({ ok: true }), 0);
        }
    },
    storage: { onChanged: { addListener(listener) { storageListeners.push(listener); } }, local: {
        get(keys, callback) {
            const data = typeof keys === 'string' ? { [keys]: fixture.data[keys] } : { ...keys, ...fixture.data };
            setTimeout(() => callback(copy(data)), 0);
        },
        set(data, callback) { fixture.writes.push(copy(data)); Object.assign(fixture.data, copy(data)); setTimeout(() => callback?.(), 0); },
        remove(key, callback) { delete fixture.data[key]; setTimeout(() => callback?.(), 0); }
    } },
    bookmarks: {
        getTree(callback) { setTimeout(() => {
            if (fixture.failBookmarks) chrome.runtime.lastError = { message: 'Temporary read failure' };
            callback(fixture.failBookmarks ? undefined : copy(fixture.tree));
            delete chrome.runtime.lastError;
        }, 0); },
        getSubTree(id, callback) { setTimeout(() => callback([copy(find(id))]), 0); }
    }
};
window.confirm = () => true;
window.alert = text => { fixture.alert = text; };
`;

async function connect(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    let id = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
        const request = pending.get(message.id);
        if (request) {
            pending.delete(message.id);
            message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
        }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    return { call, evaluate, errors, close: () => socket.close() };
}

async function until(browser, expression) {
    for (let i = 0; i < 100; i++) {
        if (await browser.evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out waiting for ${expression}`);
}

test('desktop integration with real GridStack and mocked Chrome APIs', { timeout: 30000 }, async t => {
    const server = createServer(async (request, response) => {
        const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
        if (!path.startsWith(root + '/')) { response.writeHead(403).end(); return; }
        try {
            const content = await readFile(path);
            const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)] || 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': mime }).end(content);
        } catch { response.writeHead(404).end(); }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const profile = await mkdtemp(join(tmpdir(), 'signpost-browser-'));
    const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    t.after(async () => {
        child.kill();
        await once(child, 'exit').catch(() => {});
        await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    let stderr = '';
    const endpoint = await new Promise((resolve, reject) => {
        child.stderr.on('data', chunk => {
            stderr += chunk;
            const match = stderr.match(/DevTools listening on ws:\/\/([^/]+)/);
            if (match) resolve('http://' + match[1]);
        });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Chrome exited ${code}: ${stderr}`)));
    });
    const pages = await (await fetch(endpoint + '/json/list')).json();
    const browser = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    t.after(() => browser.close());
    await browser.call('Runtime.enable');
    await browser.call('Page.enable');
    const injection = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: mock });
    const url = `http://127.0.0.1:${server.address().port}/signpost.html`;
    await browser.call('Page.navigate', { url });
    await until(browser, `document.querySelector('.bookmark-title')?.textContent === 'Updated title' && fixture.writes.some(write => write.tiles)`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.grid-stack-item').length`), 2);
    assert.equal(await browser.evaluate(`fixture.data.tiles.find(tile => tile.id === '10').textColor`), '#abcdef');
    assert.equal(await browser.evaluate(`document.querySelector('[gs-id="10"] .tile').style.backgroundColor`), 'rgba(18, 52, 86, 0.5)');

    // Settings tabs switch visible actions and support keyboard navigation.
    await browser.evaluate(`document.getElementById('btn-settings').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-backup').hidden`), true);
    await browser.evaluate(`document.getElementById('settings-tab-backup').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-configure').hidden`), true);
    assert.equal(await browser.evaluate(`document.getElementById('export-settings').checkVisibility()`), true);
    assert.equal(await browser.evaluate(`document.getElementById('reset-settings').checkVisibility()`), false);
    await browser.evaluate(`document.getElementById('settings-tab-backup').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'settings-tab-configure');
    assert.equal(await browser.evaluate(`document.getElementById('settings-tab-configure').getAttribute('aria-selected')`), 'true');
    assert.equal(await browser.evaluate(`document.getElementById('settings-backup').hidden`), true);
    assert.equal(await browser.evaluate(`document.getElementById('reset-settings').checkVisibility()`), true);
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click()`);

    // Invalid files report an error, and cancelling a valid import leaves state intact.
    await browser.evaluate(`const badFiles = new DataTransfer(); badFiles.items.add(new File(['{}'], 'bad.json', { type: 'application/json' })); document.getElementById('import-settings').files = badFiles.files; document.getElementById('import-settings').dispatchEvent(new Event('change'));`);
    await until(browser, `document.getElementById('import-status').textContent.startsWith('Import failed:')`);
    assert.equal(await browser.evaluate(`document.getElementById('import-status').textContent`), 'Import failed: format: required field is missing. Your configuration has not been changed.');
    await browser.evaluate(`(async () => {
        const { createExport } = await import('./js/config.js');
        const config = createExport({}, [], fixture.tree);
        const files = new DataTransfer(); files.items.add(new File([JSON.stringify(config)], 'config.json', { type: 'application/json' }));
        fixture.beforeImport = JSON.stringify(fixture.data);
        window.confirm = () => false;
        document.getElementById('import-settings').files = files.files;
        document.getElementById('import-settings').dispatchEvent(new Event('change'));
    })()`);
    await until(browser, `!document.getElementById('import-settings').disabled`);
    assert.equal(await browser.evaluate(`JSON.stringify(fixture.data) === fixture.beforeImport`), true);
    assert.equal(await browser.evaluate(`document.getElementById('import-status').textContent`), '');
    await browser.evaluate(`window.confirm = () => true`);

    // Popup and context-menu writes must appear without navigating or reloading.
    await browser.evaluate(`fixture.externalAdd({ id: '50', x: 5, y: 0, w: 1, h: 1, backgroundColor: '', textColor: '', bookmarkSnapshot: { id: '50', title: 'Added externally', url: 'https://external.example/', isFolder: false, children: [] } })`);
    await until(browser, `document.querySelector('[gs-id="50"] .bookmark-title')?.textContent === 'Added externally'`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[gs-id="50"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[gs-id="10"] .tile').style.backgroundColor`), 'rgba(18, 52, 86, 0.5)');
    await browser.evaluate(`document.querySelector('[gs-id="50"] .remove-tile').click()`);
    await until(browser, `!fixture.data.tiles.some(tile => tile.id === '50')`);

    // Replaced tile markup still responds to delegated actions.
    await browser.evaluate(`document.querySelector('.bookmark-folder').click()`);
    await until(browser, `fixture.data.tiles.some(tile => tile.id === '30')`);
    await browser.evaluate(`document.getElementById('btn-add').click()`);
    await until(browser, `document.querySelectorAll('.bookmark-tree-item').length === 5`);
    await browser.evaluate(`const search = document.getElementById('bookmark-search'); search.value = 'Deep'; search.dispatchEvent(new Event('input'));`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.search-match').length`), 1);
    await browser.evaluate(`document.querySelector('.search-match .bookmark-select').click()`);
    await until(browser, `fixture.data.tiles.some(tile => tile.id === '40')`);

    await browser.evaluate(`const input = document.getElementById('setting-grid-columns'); input.value = '18'; input.dispatchEvent(new Event('input'));`);
    await until(browser, `fixture.data.globalSettings.gridColumns === 18`);
    await browser.evaluate(`const newTabInput = document.getElementById('setting-new-tab'); newTabInput.checked = true; newTabInput.dispatchEvent(new Event('change'));`);
    await until(browser, `fixture.data.globalSettings.openInNewTab === true`);
    await browser.evaluate(`window.confirm = message => { fixture.resetWarning = message; return false; }; document.getElementById('reset-settings').click()`);
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.openInNewTab`), true);
    assert.match(await browser.evaluate(`fixture.resetWarning`), /irreversible/);
    await browser.evaluate(`window.confirm = () => true; document.getElementById('reset-settings').click()`);
    await until(browser, `fixture.data.globalSettings.openInNewTab === false`);
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.gridColumns`), 18);
    assert.equal(await browser.evaluate(`fixture.data.tiles.find(tile => tile.id === '10').backgroundColor`), '#123456');

    await browser.evaluate(`document.querySelector('[gs-id="40"] .tile-menu-icon').click(); document.querySelector('[gs-id="40"] .remove-tile').click();`);
    await until(browser, `!fixture.data.tiles.some(tile => tile.id === '40')`);
    assert.deepEqual(browser.errors, []);

    // Failed refresh must preserve both cached and legacy tiles without snapshots.
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: mock + `fixture.failBookmarks = true; fixture.data.tiles.push({ id: 'legacy', x: 4, y: 0, w: 1, h: 1 });` });
    await browser.call('Page.navigate', { url });
    await until(browser, `document.querySelector('.bookmark-title')?.textContent === 'Cached title'`);
    await browser.evaluate(`document.getElementById('setting-grid-columns').value = '18'; document.getElementById('setting-grid-columns').dispatchEvent(new Event('input'));`);
    assert.equal(await browser.evaluate(`document.querySelector('.bookmark-title').textContent`), 'Cached title');
    assert.equal(await browser.evaluate(`fixture.data.tiles.length`), 3);
    assert.ok(await browser.evaluate(`fixture.data.tiles.some(tile => tile.id === 'legacy')`));
    await browser.evaluate(`document.querySelector('[gs-id="10"] .remove-tile').click()`);
    await until(browser, `!fixture.data.tiles.some(tile => tile.id === '10')`);
    assert.ok(await browser.evaluate(`fixture.data.tiles.some(tile => tile.id === 'legacy')`));
    assert.deepEqual(browser.errors, []);
});
