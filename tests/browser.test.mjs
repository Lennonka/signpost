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

    // Fresh pages start with Themes; reopening Settings preserves the selected tab.
    await browser.evaluate(`document.getElementById('btn-settings').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-themes').hidden`), false);
    assert.equal(await browser.evaluate(`document.querySelector('.settings-tabs [role="tab"]').id`), 'settings-tab-themes');
    await browser.evaluate(`document.getElementById('settings-tab-configure').click(); document.querySelector('#settings-panel .btn-close').click(); document.getElementById('btn-settings').click();`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-configure').hidden`), false);
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click()`);

    // Desktop text sizing must not resize dialogs or status messages.
    const uiTextSizes = `['#settings-panel', '#bookmark-picker', '#setup-description', '#setup-status', '#import-status', '#bubble-message', '#onboarding-hint'].map(selector => getComputedStyle(document.querySelector(selector)).fontSize)`;
    const originalUiSizes = await browser.evaluate(uiTextSizes);
    for (const size of [8, 24, 14]) {
        await browser.evaluate(`{ const input = document.getElementById('setting-desktop-text-size'); input.value = '${size}'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); }`);
        await until(browser, `fixture.data.globalSettings.desktopTextSize === ${size}`);
        assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="10"] .bookmark-title')).fontSize`), `${size}px`);
        assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).fontSize`), `${size}px`);
        assert.deepEqual(await browser.evaluate(uiTextSizes), originalUiSizes);
    }

    // Tile pickers replace the menu and retain live updates and keyboard dismissal.
    await browser.evaluate(`document.querySelector('[gs-id="10"] .tile-menu-icon').click(); fixture.menuRect = document.querySelector('[gs-id="10"] .tile-menu').getBoundingClientRect().toJSON(); document.querySelector('[gs-id="10"] .set-bg-color').click();`);
    assert.equal(await browser.evaluate(`document.querySelector('[gs-id="10"] .tile-menu').classList.contains('hidden')`), true);
    assert.equal(await browser.evaluate(`Math.abs(document.querySelector('.color-picker').getBoundingClientRect().left - fixture.menuRect.left) < 1`), true);
    // Clicking and dragging the gradient updates the color; changing hue preserves its selection.
    await browser.evaluate(`document.querySelector('.color-picker-hue').value = '0'; document.querySelector('.color-picker-hue').dispatchEvent(new Event('input'));`);
    const square = await browser.evaluate(`document.querySelector('.color-picker-square').getBoundingClientRect().toJSON()`);
    await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: square.right - 1, y: square.top + 1, button: 'left', clickCount: 1 });
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: square.right, y: square.top, button: 'left', buttons: 1 });
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: square.right, y: square.top, button: 'left', clickCount: 1 });
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker-hex').value`), '#ff0000');
    await browser.evaluate(`document.querySelector('.color-picker-hue').value = '120'; document.querySelector('.color-picker-hue').dispatchEvent(new Event('input'));`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker-hex').value`), '#00ff00');
    await browser.evaluate(`document.querySelector('.color-picker-square').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker-hex').value`), '#00fc00');
    await browser.evaluate(`const hex = document.querySelector('.color-picker-hex'); hex.value = '#234567'; hex.dispatchEvent(new Event('input'));`);
    await until(browser, `fixture.data.tiles.find(tile => tile.id === '10').backgroundColor === '#234567'`);
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker')`), null);
    await until(browser, `document.activeElement.classList.contains('tile-menu-icon')`);
    // Restore the fixture color used by later assertions.
    await browser.evaluate(`document.querySelector('[gs-id="10"] .tile-menu-icon').click(); document.querySelector('[gs-id="10"] .set-bg-color').click(); { const hex = document.querySelector('.color-picker-hex'); hex.value = '#123456'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await until(browser, `fixture.data.tiles.find(tile => tile.id === '10').backgroundColor === '#123456'`);

    // Settings picker opens left of the swatch and fits after viewport resizing.
    await browser.evaluate(`document.getElementById('btn-settings').click(); document.getElementById('setting-background-color').click();`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker').getBoundingClientRect().right <= document.getElementById('setting-background-color').getBoundingClientRect().left - 7`), true);
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 240, deviceScaleFactor: 1, mobile: false });
    await until(browser, `(() => { const r = document.querySelector('.color-picker').getBoundingClientRect(); return r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8; })()`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker').scrollHeight <= document.querySelector('.color-picker').clientHeight`), true);
    await browser.call('Emulation.clearDeviceMetricsOverride');
    await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 });
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 });
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker')`), null);
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click();`);

    // The image stays below the body overlay; controls preview and persist independently.
    assert.equal(await browser.evaluate(`document.querySelector('#settings-configure .setting-row strong').textContent`), 'Background image');
    assert.equal(await browser.evaluate(`document.getElementById('setting-background-transparency').value`), '50');
    await browser.evaluate(`(() => {
        const files = new DataTransfer();
        files.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path fill="red" d="M0 0h10v10H0z"/></svg>'], 'background.svg', { type: 'image/svg+xml' }));
        const input = document.getElementById('setting-background-image');
        input.files = files.files; input.dispatchEvent(new Event('change'));
    })()`);
    await until(browser, `Boolean(fixture.data.desktopBackgroundImage)`);
    assert.match(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), /data:image/);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'none');
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(255, 255, 255, 0.5)');
    await browser.evaluate(`document.getElementById('btn-settings').click(); document.getElementById('setting-background-color').click(); { const hex = document.querySelector('.color-picker-hex'); hex.value = '#123456'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(18, 52, 86, 0.5)');
    for (const [transparency, color] of [[0, 'rgb(18, 52, 86)'], [100, 'rgba(18, 52, 86, 0)'], [75, 'rgba(18, 52, 86, 0.25)']]) {
        await browser.evaluate(`{ const input = document.getElementById('setting-background-transparency'); input.value = '${transparency}'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); }`);
        assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), color);
        await until(browser, `fixture.data.globalSettings.desktopBackgroundTransparency === ${transparency}`);
    }
    assert.equal(await browser.evaluate(`document.getElementById('overlay-end-row').hidden`), true);
    // Each direction is selectable; the overlay stays above the image with one shared alpha.
    const directions = ['to top', 'to top right', 'to right', 'to bottom right', 'to bottom', 'to bottom left', 'to left', 'to top left'];
    for (const direction of directions) {
        await browser.evaluate(`document.getElementById('setting-overlay-mode').click(); document.querySelector('[data-direction="${direction}"]').click()`);
        await until(browser, `fixture.data.globalSettings.desktopBackgroundDirection === '${direction}' && fixture.data.globalSettings.desktopBackgroundOverlay === 'gradient'`);
        assert.match(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), new RegExp('linear-gradient\\(' + (direction === 'to bottom' ? 'rgba' : direction.replace(/to (top|bottom) (left|right)/, 'to $2 $1'))));
        assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(0, 0, 0, 0)');
    }
    assert.equal(await browser.evaluate(`document.getElementById('overlay-end-row').hidden`), false);
    assert.equal(await browser.evaluate(`document.getElementById('overlay-start-label').textContent`), 'Start color');
    await browser.evaluate(`document.getElementById('setting-background-end-color').click(); { const hex = document.querySelector('.color-picker-hex'); hex.value = '#fedcba'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await until(browser, `fixture.data.globalSettings.desktopBackgroundEndColor === '#fedcba'`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'linear-gradient(to left top, rgba(18, 52, 86, 0.25), rgba(254, 220, 186, 0.25))');
    await browser.evaluate(`document.getElementById('setting-overlay-mode').click(); document.querySelector('[data-overlay-mode="solid"]').click()`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'none');
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(18, 52, 86, 0.25)');
    assert.equal(await browser.evaluate(`document.getElementById('overlay-end-row').hidden`), true);
    await browser.evaluate(`document.getElementById('setting-overlay-mode').click(); document.querySelector('[data-direction="to top left"]').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('setting-background-end-color').value`), '#fedcba');
    await browser.evaluate(`{ const input = document.getElementById('setting-background-transparency'); input.value = '100'; input.dispatchEvent(new Event('input')); }`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'linear-gradient(to left top, rgba(18, 52, 86, 0), rgba(254, 220, 186, 0))');
    assert.match(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), /data:image/);
    await browser.evaluate(`document.getElementById('setting-overlay-mode').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    assert.equal(await browser.evaluate(`document.getElementById('overlay-options').hidden`), true);
    await browser.evaluate(`document.getElementById('clear-background').click()`);
    await until(browser, `!fixture.data.desktopBackgroundImage && fixture.data.globalSettings.desktopBackgroundTransparency === 50`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), 'none');
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(255, 255, 255, 0.5)');
    assert.equal(await browser.evaluate(`document.getElementById('setting-background-image').value`), '');
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click()`);

    // Folder defaults apply live without replacing individual title overrides.
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(0, 0, 0)');
    assert.equal(await browser.evaluate(`document.getElementById('setting-default-tile-background-color').closest('label').nextElementSibling.querySelector('strong').textContent`), 'Default folder title color');
    await browser.evaluate(`document.getElementById('btn-settings').click(); document.getElementById('setting-default-folder-title-color').click(); { const hex = document.querySelector('.color-picker-hex'); hex.value = '#345678'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await until(browser, `fixture.data.globalSettings.defaultFolderTitleColor === '#345678'`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(52, 86, 120)');
    assert.equal(await browser.evaluate(`document.querySelector('[gs-id="10"] .bookmark-title').style.color`), 'rgb(171, 205, 239)');
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click(); document.querySelector('[gs-id="20"] .tile-menu-icon').click(); document.querySelector('[gs-id="20"] .set-text-color').click()`);
    assert.equal(await browser.evaluate(`document.querySelector('.color-picker-hex').value`), '#345678');
    await browser.evaluate(`{ const hex = document.querySelector('.color-picker-hex'); hex.value = '#987654'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await until(browser, `fixture.data.tiles.find(tile => tile.id === '20').textColor === '#987654'`);
    await browser.evaluate(`document.getElementById('btn-settings').click(); document.getElementById('setting-default-folder-title-color').click(); { const hex = document.querySelector('.color-picker-hex'); hex.value = '#456789'; hex.dispatchEvent(new Event('input')); } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await until(browser, `fixture.data.globalSettings.defaultFolderTitleColor === '#456789'`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(152, 118, 84)');
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click()`);

    // Settings tabs switch visible actions and support keyboard navigation.
    await browser.evaluate(`document.getElementById('btn-settings').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-backup').hidden`), true);
    await browser.evaluate(`document.getElementById('settings-tab-backup').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-configure').hidden`), true);
    assert.equal(await browser.evaluate(`document.getElementById('export-settings').checkVisibility()`), true);
    assert.equal(await browser.evaluate(`document.getElementById('reset-settings').checkVisibility()`), false);
    await browser.evaluate(`document.getElementById('settings-tab-backup').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))`);
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'settings-tab-themes');
    assert.equal(await browser.evaluate(`document.getElementById('settings-themes').hidden`), false);
    await browser.evaluate(`document.getElementById('settings-tab-themes').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
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
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="30"] .folder-title')).color`), 'rgb(69, 103, 137)');
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
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.defaultFolderTitleColor`), '#000000');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="30"] .folder-title')).color`), 'rgb(0, 0, 0)');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(152, 118, 84)');
    assert.equal(await browser.evaluate(`fixture.data.tiles.find(tile => tile.id === '10').backgroundColor`), '#123456');

    await browser.evaluate(`document.querySelector('[gs-id="40"] .tile-menu-icon').click(); document.querySelector('[gs-id="40"] .remove-tile').click();`);
    await until(browser, `!fixture.data.tiles.some(tile => tile.id === '40')`);
    assert.deepEqual(browser.errors, []);

    // Failed refresh must preserve both cached and legacy tiles without snapshots.
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    const failedInjection = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: mock + `fixture.data.globalSettings.defaultFolderTitleColor = '#345678'; fixture.data.globalSettings.desktopBackgroundColor = '#123456'; fixture.data.globalSettings.desktopBackgroundTransparency = 75; fixture.data.desktopBackgroundImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; fixture.failBookmarks = true; fixture.data.tiles.push({ id: 'legacy', x: 4, y: 0, w: 1, h: 1 });` });
    await browser.call('Page.navigate', { url });
    await until(browser, `document.querySelector('.bookmark-title')?.textContent === 'Cached title'`);
    await browser.evaluate(`document.getElementById('setting-grid-columns').value = '18'; document.getElementById('setting-grid-columns').dispatchEvent(new Event('input'));`);
    assert.equal(await browser.evaluate(`document.querySelector('.bookmark-title').textContent`), 'Cached title');
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgba(18, 52, 86, 0.25)');
    assert.equal(await browser.evaluate(`document.getElementById('setting-background-transparency').value`), '75');
    assert.match(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), /data:image/);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'none');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(52, 86, 120)');
    assert.equal(await browser.evaluate(`fixture.data.tiles.length`), 3);
    assert.ok(await browser.evaluate(`fixture.data.tiles.some(tile => tile.id === 'legacy')`));
    await browser.evaluate(`document.querySelector('[gs-id="10"] .remove-tile').click()`);
    await until(browser, `!fixture.data.tiles.some(tile => tile.id === '10')`);
    assert.ok(await browser.evaluate(`fixture.data.tiles.some(tile => tile.id === 'legacy')`));
    assert.deepEqual(browser.errors, []);

    // Themes preserve layout, text size, wallpaper, and saved tile overrides.
    await browser.evaluate(`window.themeBefore = JSON.stringify(fixture.data.tiles); document.getElementById('settings-tab-themes').click(); document.querySelectorAll('.theme-choice')[1].click();`);
    await until(browser, `fixture.data.globalSettings.desktopBackgroundColor === '#101725' && document.getElementById('setting-background-color').value === '#101725'`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-themes').hidden`), false);
    assert.equal(await browser.evaluate(`JSON.stringify(fixture.data.tiles) === window.themeBefore`), true);
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.desktopBackgroundColor`), '#101725');
    assert.equal(await browser.evaluate(`document.querySelector('.theme-choice[aria-pressed="true"] strong').textContent`), 'Midnight');
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.gridColumns`), 18);
    assert.equal(await browser.evaluate(`fixture.data.globalSettings.desktopTextSize`), 14);
    assert.match(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), /data:image/);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[gs-id="20"] .folder-title')).color`), 'rgb(196, 217, 255)');
    await browser.evaluate(`window.beforeInvalidTheme = JSON.stringify(fixture.data); {
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify({ format: 'signpost-theme', version: 1, name: 'Invalid', settings: { desktopTextSize: 24 } })], 'invalid.json'));
        const input = document.getElementById('import-theme'); input.files = files.files; input.dispatchEvent(new Event('change'));
    }`);
    await until(browser, `document.getElementById('theme-status').textContent.includes('Unknown theme setting')`);
    assert.equal(await browser.evaluate(`JSON.stringify(fixture.data) === window.beforeInvalidTheme`), true);
    await browser.evaluate(`{
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify({ format: 'signpost-theme', version: 1, name: 'Imported', settings: { desktopBackgroundColor: '#101725', desktopBackgroundOverlay: 'gradient', desktopBackgroundImage: null } })], 'theme.json'));
        const input = document.getElementById('import-theme'); input.files = files.files; input.dispatchEvent(new Event('change'));
    }`);
    await until(browser, `fixture.data.desktopBackgroundImage === null && document.getElementById('theme-status').textContent === ''`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.documentElement).backgroundImage`), 'none');
    assert.equal(await browser.evaluate(`fixture.data.desktopBackgroundImage`), null);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.theme-choice[aria-pressed="true"]').length`), 0);
    assert.equal(await browser.evaluate(`JSON.stringify(fixture.data.tiles) === window.themeBefore`), true);
    await browser.evaluate(`document.getElementById('settings-tab-configure').click()`);
    await until(browser, `fixture.data.settingsTab === 'settings-tab-configure'`);
    const themedState = await browser.evaluate(`JSON.stringify(fixture.data)`);
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: failedInjection.identifier });
    const themeInjection = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: mock + `fixture.data = ${themedState};` });
    await browser.call('Page.navigate', { url });
    await until(browser, `document.querySelector('[gs-id="20"] .folder-title') && document.getElementById('setting-background-color').value === '#101725'`);
    assert.match(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), /linear-gradient/);
    assert.equal(await browser.evaluate(`document.getElementById('settings-configure').hidden`), false);
    assert.equal(await browser.evaluate(`document.getElementById('settings-tab-configure').getAttribute('aria-selected')`), 'true');
    assert.deepEqual(browser.errors, []);

    // First-run choices, cancellations, and intentionally empty desktops.
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: themeInjection.identifier });
    let onboardingInjection;
    let navigation = 0;
    async function openFresh(extra = '') {
        if (onboardingInjection) await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: onboardingInjection.identifier });
        navigation += 1;
        onboardingInjection = await browser.call('Page.addScriptToEvaluateOnNewDocument', {
            source: mock + `fixture.data.tiles = []; fixture.data.setupComplete = false; fixture.navigation = ${navigation};` + extra
        });
        await browser.call('Page.navigate', { url });
        await until(browser, `window.fixture?.navigation === ${navigation} && document.getElementById('setup-prompt') && (!document.getElementById('setup-prompt').classList.contains('hidden') || !document.getElementById('desktop-empty').classList.contains('hidden') || document.querySelectorAll('.grid-stack-item').length > 0)`);
    }
    await openFresh(`fixture.data.setupComplete = true; Object.assign(fixture.data.globalSettings, { desktopBackgroundOverlay: 'gradient', desktopBackgroundDirection: 'to right', desktopBackgroundColor: '#123456', desktopBackgroundEndColor: '#fedcba', desktopBackgroundTransparency: 75 });`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).backgroundImage`), 'linear-gradient(to right, rgba(18, 52, 86, 0.25), rgba(254, 220, 186, 0.25))');
    assert.equal(await browser.evaluate(`document.getElementById('overlay-end-row').hidden`), false);
    await openFresh();
    await until(browser, `!document.getElementById('load-bookmarks').disabled`);
    assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('.onboarding-options button strong'), node => node.textContent)`),
        ['Use my Bookmarks Bar', 'Choose bookmarks and folders', 'Restore a Signpost backup', 'Start from blank desktop']);
    assert.match(await browser.evaluate(`document.getElementById('setup-bookmark-count').textContent`), /1 bookmark and 1 folder/);
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: false });
    assert.equal(await browser.evaluate(`(() => { const r = document.getElementById('setup-prompt').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), true);
    await browser.call('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate(`document.getElementById('start-empty').click()`);
    await until(browser, `fixture.data.setupComplete === true && !document.getElementById('desktop-empty').classList.contains('hidden')`);
    assert.equal(await browser.evaluate(`document.getElementById('onboarding-hint').classList.contains('hidden')`), false);
    const blankState = await browser.evaluate(`JSON.stringify(fixture.data)`);
    await openFresh(`Object.assign(fixture.data, ${blankState});`);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), true);
    assert.equal(await browser.evaluate(`document.getElementById('onboarding-hint').classList.contains('hidden')`), false);
    await browser.evaluate(`document.getElementById('dismiss-onboarding-hint').click()`);
    await until(browser, `fixture.data.onboardingHintDismissed === true`);
    const dismissedState = await browser.evaluate(`JSON.stringify(fixture.data)`);
    await openFresh(`Object.assign(fixture.data, ${dismissedState});`);
    assert.equal(await browser.evaluate(`document.getElementById('onboarding-hint').classList.contains('hidden')`), true);
    await browser.evaluate(`document.getElementById('empty-add-bookmark').click()`);
    await until(browser, `document.querySelectorAll('.bookmark-tree-item').length === 5`);
    await browser.evaluate(`document.querySelector('.bookmark-link-select').click()`);
    await until(browser, `document.getElementById('desktop-empty').classList.contains('hidden')`);

    await openFresh();
    await browser.evaluate(`document.getElementById('choose-bookmarks').click()`);
    await until(browser, `document.querySelectorAll('.bookmark-tree-item').length === 5`);
    await browser.evaluate(`document.querySelector('#bookmark-picker .btn-close').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), false);
    assert.equal(await browser.evaluate(`fixture.data.setupComplete`), false);
    await browser.evaluate(`document.getElementById('choose-bookmarks').click()`);
    await until(browser, `document.querySelector('.bookmark-link-select') !== null`);
    await browser.evaluate(`document.querySelector('.bookmark-link-select').click()`);
    await until(browser, `fixture.data.setupComplete === true`);
    assert.equal(await browser.evaluate(`fixture.data.tiles.length`), 1);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), true);

    await openFresh();
    await until(browser, `!document.getElementById('load-bookmarks').disabled`);
    await browser.evaluate(`document.getElementById('load-bookmarks').click()`);
    await until(browser, `fixture.data.setupComplete === true`);
    assert.equal(await browser.evaluate(`fixture.data.tiles.length`), 2);
    assert.equal(await browser.evaluate(`fixture.data.tiles.some(tile => tile.id === '30')`), false);

    await openFresh(`fixture.tree[0].children[0].children = [];`);
    await until(browser, `document.getElementById('setup-bookmark-count').textContent.includes('empty')`);
    assert.equal(await browser.evaluate(`document.getElementById('load-bookmarks').disabled`), true);
    assert.equal(await browser.evaluate(`document.getElementById('start-empty').disabled`), false);
    await browser.evaluate(`document.getElementById('restore-backup').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('settings-backup').hidden`), false);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), true);
    await browser.evaluate(`document.querySelector('#settings-panel .btn-close').click()`);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), false);

    await openFresh(`chrome.bookmarks.getSubTree = (id, callback) => { chrome.runtime.lastError = { message: 'Unavailable' }; callback(); delete chrome.runtime.lastError; };`);
    await until(browser, `document.getElementById('setup-bookmark-count').textContent.includes('unavailable')`);
    assert.equal(await browser.evaluate(`document.getElementById('load-bookmarks').disabled`), true);
    await browser.evaluate(`document.getElementById('start-empty').click()`);
    await until(browser, `fixture.data.setupComplete === true`);
    await openFresh(`chrome.storage.local.set = (data, callback) => { chrome.runtime.lastError = { message: 'Storage full' }; callback(); delete chrome.runtime.lastError; };`);
    await browser.evaluate(`document.getElementById('start-empty').click()`);
    await until(browser, `document.getElementById('setup-status').textContent.includes('Storage full')`);
    assert.equal(await browser.evaluate(`fixture.data.setupComplete`), false);
    assert.equal(await browser.evaluate(`document.getElementById('setup-prompt').classList.contains('hidden')`), false);
    assert.equal(await browser.evaluate(`document.getElementById('start-empty').disabled`), false);
    assert.deepEqual(browser.errors, []);
});
