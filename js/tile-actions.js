import { normalizeColorPickerValue } from './colors.js';
import { bookmarksGetSubTree } from './bookmarks.js';

// One desktop listener survives tile content replacement without rebinding.
export function bindTileActions({ grid, globalSettings, renderer, saveLayout, addTileToGrid, findChildFolderTilePosition }) {
    const desktop = document.getElementById('desktop');
    let activeMenu = null;
    let closePicker = () => {};
    const { applyTileBackground, applyFolderTitleColor, applyBookmarkLinkTextColor,
        getDefaultTileBackgroundColor, getDefaultLinkTextColor } = renderer;

    function hideMenu() {
        activeMenu?.classList.add('hidden');
        activeMenu = null;
    }

    function openColorPicker(onChange, initialColor) {
        closePicker();
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = normalizeColorPickerValue(initialColor) || '#000000';
        picker.style.position = 'absolute';
        picker.style.left = '-9999px';
        const outsideClick = event => {
            if (event.target !== picker) closePicker();
        };
        closePicker = () => {
            picker.remove();
            document.removeEventListener('click', outsideClick);
            closePicker = () => {};
        };
        picker.addEventListener('input', () => onChange(picker.value));
        picker.addEventListener('change', () => closePicker());
        picker.addEventListener('cancel', () => closePicker());
        document.body.appendChild(picker);
        picker.click();
        document.addEventListener('click', outsideClick);
    }

    document.addEventListener('click', event => {
        if (!event.target.closest('.tile-menu-icon')) hideMenu();
    });

    desktop.addEventListener('click', async event => {
        const tileEl = event.target.closest('.grid-stack-item');
        if (!tileEl) return;
        const node = tileEl.gridstackNode;
        const action = event.target.closest('.tile-menu-item');
        const icon = event.target.closest('.tile-menu-icon');
        const folder = event.target.closest('.bookmark-folder');
        if (!action && !icon && !folder) return;
        event.stopPropagation();

        if (action) {
            hideMenu();
            if (action.classList.contains('remove-tile')) {
                if (!globalSettings.confirmBeforeRemove || confirm('Remove this tile?')) {
                    grid.removeWidget(tileEl);
                    saveLayout();
                }
            } else if (action.classList.contains('reset-bg-color')) {
                delete node.backgroundColor;
                applyTileBackground(tileEl);
                saveLayout();
            } else if (action.classList.contains('set-bg-color')) {
                openColorPicker(color => {
                    node.backgroundColor = color;
                    applyTileBackground(tileEl, color);
                    saveLayout();
                }, node.backgroundColor || getDefaultTileBackgroundColor());
            } else {
                const isFolder = action.classList.contains('set-text-color');
                openColorPicker(color => {
                    node.textColor = color;
                    (isFolder ? applyFolderTitleColor : applyBookmarkLinkTextColor)(tileEl, color);
                    saveLayout();
                }, node.textColor || (isFolder ? '#000000' : getDefaultLinkTextColor()));
            }
        } else if (icon) {
            const menu = icon.querySelector('.tile-menu');
            const wasOpen = activeMenu === menu && !menu.classList.contains('hidden');
            hideMenu();
            if (!wasOpen) {
                activeMenu = menu;
                menu.classList.remove('hidden');
                menu.classList.toggle('flip-left', icon.getBoundingClientRect().left + menu.getBoundingClientRect().width > window.innerWidth);
            }
        } else if (folder) {
            try {
                const [bookmark] = await bookmarksGetSubTree(folder.dataset.id);
                if (bookmark) addTileToGrid(bookmark, findChildFolderTilePosition(node, bookmark));
            } catch (error) {
                console.warn('Could not open bookmark folder.', error);
            }
        }
    });
}
