import { bookmarksGetSubTree } from './bookmarks.js';
import { storageGet, storageSet, reportStorageError } from './storage.js';
import { openModal, closeModal } from './ui.js';

export function createOnboarding(desktop) {
    const modal = document.getElementById('setup-prompt');
    const status = document.getElementById('setup-status');
    const loadButton = document.getElementById('load-bookmarks');
    const empty = document.getElementById('desktop-empty');
    const hint = document.getElementById('onboarding-hint');
    let completed = false;
    let hintDismissed = true;
    let bar;
    let loadingBar;
    let busy = false;

    function render() {
        empty.classList.toggle('hidden', !completed || desktop.grid.getGridItems().length > 0);
        hint.classList.toggle('hidden', !completed || hintDismissed);
    }

    async function loadBar() {
        try {
            [bar] = await bookmarksGetSubTree('1');
            if (!bar) throw new Error('Bookmarks Bar is unavailable.');
            const children = bar.children || [];
            const bookmarks = children.filter(node => node.url).length;
            const folders = children.length - bookmarks;
            document.getElementById('setup-bookmark-count').textContent = children.length
                ? `Add ${bookmarks} bookmark${bookmarks === 1 ? '' : 's'} and ${folders} folder${folders === 1 ? '' : 's'} as tiles. Folder contents stay grouped.`
                : 'Your Bookmarks Bar is empty. Choose another way to start.';
            loadButton.disabled = children.length === 0;
        } catch (error) {
            document.getElementById('setup-bookmark-count').textContent = 'Bookmarks Bar unavailable. You can choose bookmarks or start blank.';
            loadButton.disabled = true;
            console.warn('Could not read Bookmarks Bar.', error);
        }
    }

    function showWelcome() {
        openModal(modal);
        document.getElementById('choose-bookmarks').focus();
        loadingBar ||= loadBar();
    }

    async function complete() {
        if (completed) return;
        try {
            await desktop.saveLayout();
            await storageSet({ setupComplete: true, onboardingHintDismissed: false });
        } catch (error) {
            showWelcome();
            status.textContent = `Could not finish setup. ${error.message} Please try again.`;
            throw error;
        }
        completed = true;
        hintDismissed = false;
        closeModal(modal);
        render();
        document.getElementById('btn-add').focus();
    }

    async function run(action) {
        if (busy) return;
        busy = true;
        status.textContent = '';
        modal.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
            await action();
        } catch (error) {
            status.textContent = `Could not finish setup. ${error.message} Please try again.`;
        } finally {
            busy = false;
            modal.querySelectorAll('button').forEach(button => { button.disabled = false; });
            loadButton.disabled = !bar?.children?.length;
        }
    }

    loadButton.addEventListener('click', () => run(async () => {
        desktop.importBookmarks(bar.children);
        await complete();
    }));
    document.getElementById('start-empty').addEventListener('click', () => run(complete));
    document.getElementById('choose-bookmarks').addEventListener('click', () => {
        closeModal(modal);
        document.getElementById('btn-add').click();
    });
    document.getElementById('restore-backup').addEventListener('click', () => {
        closeModal(modal);
        document.getElementById('btn-settings').click();
        document.getElementById('settings-tab-backup').click();
        document.getElementById('import-settings').focus();
        document.getElementById('import-settings').click();
    });
    document.querySelectorAll('#bookmark-picker .btn-close, #settings-panel .btn-close').forEach(button => {
        button.addEventListener('click', () => {
            if (!completed) showWelcome();
        });
    });
    // Toolbar toggles can also close a picker or Settings during setup.
    for (const [button, panel] of [['btn-add', 'bookmark-picker'], ['btn-settings', 'settings-panel']]) {
        document.getElementById(button).addEventListener('click', () => {
            if (!completed && document.getElementById(panel).classList.contains('hidden')) showWelcome();
        });
    }
    document.getElementById('empty-add-bookmark').addEventListener('click', () => document.getElementById('btn-add').click());
    document.getElementById('dismiss-onboarding-hint').addEventListener('click', async () => {
        try {
            await storageSet({ onboardingHintDismissed: true });
            hintDismissed = true;
            render();
        } catch (error) {
            reportStorageError(error);
        }
    });
    new MutationObserver(render).observe(document.getElementById('desktop'), { childList: true });

    return {
        complete,
        async prepareRestore() {
            if (!completed) await storageSet({ onboardingHintDismissed: false });
        },
        async initialize() {
            const data = await storageGet({ setupComplete: false, onboardingHintDismissed: true });
            completed = data.setupComplete;
            hintDismissed = data.onboardingHintDismissed;
        },
        handleEmpty(setupComplete) {
            completed = Boolean(setupComplete);
            if (!completed) showWelcome();
            render();
        }
    };
}
