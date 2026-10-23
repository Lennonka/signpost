import { downloadExport } from './js/config.js';
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
