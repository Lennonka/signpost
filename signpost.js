import { chromeCall } from './js/chrome-api.js';
import { bookmarksGetTree } from './js/bookmarks.js';
import { downloadExport, parseConfig, prepareImport } from './js/config.js';
import { createSettings } from './js/settings.js';
import { createTileRenderer } from './js/tiles.js';
import { createDesktop } from './js/desktop.js';
import { createBookmarkPicker } from './js/bookmark-picker.js';
import { bindToolbar, showBubbleMessage } from './js/ui.js';
import { restoreCachedBackground } from './js/background-image.js';
import { createOnboarding } from './js/onboarding.js';

async function initialize() {
    restoreCachedBackground();
    const settings = createSettings();
    let onboarding;
    const desktop = createDesktop({
        globalSettings: settings.globalSettings,
        renderer: createTileRenderer(settings.globalSettings),
        showBubbleMessage,
        onExternalTilesAdded: () => onboarding.complete().catch(error => showBubbleMessage(error.message)),
        handleEmpty: setupComplete => onboarding.handleEmpty(setupComplete)
    });
    const picker = createBookmarkPicker({
        addTileToGrid(bookmark) {
            desktop.addTileToGrid(bookmark);
            onboarding.complete().catch(error => showBubbleMessage(error.message));
        },
        showBubbleMessage
    });
    bindToolbar(picker);
    onboarding = createOnboarding(desktop);
    await onboarding.initialize();

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
            await onboarding.prepareRestore();
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
