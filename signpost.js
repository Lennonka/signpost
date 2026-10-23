import { chromeCall } from './js/chrome-api.js';
import { bookmarksGetTree } from './js/bookmarks.js';
import { downloadExport, parseConfig, prepareImport } from './js/config.js';
import { createSettings } from './js/settings.js';
import { createTileRenderer } from './js/tiles.js';
import { createDesktop } from './js/desktop.js';
import { createBookmarkPicker } from './js/bookmark-picker.js';
import { bindToolbar, openModal, closeModal, showBubbleMessage } from './js/ui.js';
import { restoreCachedBackground } from './js/background-image.js';
import { bookmarksGetSubTree } from './js/bookmarks.js';
import { persist } from './js/storage.js';

async function initialize() {
    restoreCachedBackground();
    const settings = createSettings();
    const setupModal = document.getElementById('setup-prompt');
    const desktop = createDesktop({
        globalSettings: settings.globalSettings,
        renderer: createTileRenderer(settings.globalSettings),
        showBubbleMessage,
        onExternalTilesAdded: () => closeModal(setupModal),
        handleEmpty(setupComplete) {
            if (setupComplete) persist({ setupComplete: false });
            openModal(setupModal);
        }
    });
    const picker = createBookmarkPicker({ addTileToGrid: desktop.addTileToGrid, showBubbleMessage });
    bindToolbar(picker);

    document.getElementById('load-bookmarks').addEventListener('click', async () => {
        try {
            const [bar] = await bookmarksGetSubTree('1');
            if (!bar) throw new Error('Bookmarks Bar is unavailable.');
            desktop.importBookmarks(bar.children || []);
            await persist({ setupComplete: true });
            closeModal(setupModal);
            showBubbleMessage('Imported from Bookmarks Bar');
        } catch (error) {
            console.warn('Could not import Bookmarks Bar.', error);
            alert('Could not access Bookmarks Bar.');
        }
    });
    document.getElementById('start-empty').addEventListener('click', () => {
        persist({ setupComplete: true });
        closeModal(setupModal);
        showBubbleMessage('Start with an empty desktop');
    });

    await settings.initialize(desktop);
    await desktop.loadInitialLayout();
    const importInput = document.getElementById('import-settings');
    const importStatus = document.getElementById('import-status');
    importInput.addEventListener('change', async () => {
        const file = importInput.files[0];
        if (!file) return;
        importInput.disabled = true;
        importStatus.textContent = '';
        try {
            const config = parseConfig(await file.text());
            prepareImport(config, await bookmarksGetTree());
            if (!confirm('Replace your settings, background image, and tile layout with this backup? This action is irreversible. Your browser bookmarks will remain unchanged.')) return;
            await settings.flush();
            await desktop.saveLayout();
            const response = await chromeCall(chrome.runtime, 'sendMessage', { type: 'import-signpost-config', config });
            if (!response?.ok) throw new Error(response?.error || 'Could not save the imported configuration.');
        } catch (error) {
            importStatus.textContent = `Import failed: ${error.message} Your configuration has not been changed.`;
        } finally {
            importInput.value = '';
            importInput.disabled = false;
        }
    });
    document.getElementById('export-settings').addEventListener('click', async () => {
        try {
            await downloadExport(settings.globalSettings, desktop.getLayout());
        } catch (error) {
            console.warn('Could not export Signpost.', error);
            showBubbleMessage('Could not export Signpost. Please try again.');
        }
    });
}

initialize().catch(error => {
    console.error('Could not initialize Signpost.', error);
    showBubbleMessage('Could not load Signpost. Please reload this tab.');
});
