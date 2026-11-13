import { openColorPicker } from './color-picker.js';
import { bookmarksGetSubTree } from './bookmarks.js';

// One desktop listener survives tile content replacement without rebinding.
export function bindTileActions({ grid, globalSettings, renderer, saveLayout, addTileToGrid, findChildFolderTilePosition }) {
    const desktop = document.getElementById('desktop');
    let activeMenu = null;
    const { applyTileBackground, applyFolderTitleColor, applyBookmarkLinkTextColor,
        getDefaultTileBackgroundColor, getDefaultLinkTextColor, getDefaultFolderTitleColor } = renderer;

    function hideMenu() {
        activeMenu?.classList.add('hidden');
        activeMenu = null;
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
            const menu = action.closest('.tile-menu');
            const menuRect = menu.getBoundingClientRect();
            const trigger = action.closest('.tile-menu-icon');
            const triggerRect = trigger.getBoundingClientRect();
            const pickerOptions = {
                trigger,
                alignRight: menu.classList.contains('flip-left'),
                getAnchorRect() {
                    const current = trigger.getBoundingClientRect();
                    return { left: menuRect.left + current.left - triggerRect.left,
                        right: menuRect.right + current.left - triggerRect.left,
                        top: menuRect.top + current.top - triggerRect.top };
                }
            };
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
                openColorPicker({ ...pickerOptions, onChange: color => {
                    node.backgroundColor = color;
                    applyTileBackground(tileEl, color);
                    saveLayout();
                }, initialColor: node.backgroundColor || getDefaultTileBackgroundColor(), label: 'Tile background' });
            } else {
                const isFolder = action.classList.contains('set-text-color');
                openColorPicker({ ...pickerOptions, onChange: color => {
                    node.textColor = color;
                    (isFolder ? applyFolderTitleColor : applyBookmarkLinkTextColor)(tileEl, color);
                    saveLayout();
                }, initialColor: node.textColor || (isFolder ? getDefaultFolderTitleColor() : getDefaultLinkTextColor()), label: isFolder ? 'Title color' : 'Link text color' });
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
