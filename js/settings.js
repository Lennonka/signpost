import { defaultSettings, normalizeDesktopTextSize, normalizeGridColumns } from './model.js';
import { storageGet, persist, storageRemove, reportStorageError } from './storage.js';
import { applyDesktopBackgroundImage, cacheDesktopBackgroundImage,
    clearDesktopBackgroundImage, removeCachedDesktopBackgroundImage } from './background-image.js';

const controls = {
    openInNewTab: ['setting-new-tab', 'change', 'checked'],
    confirmBeforeRemove: ['setting-confirm-remove', 'change', 'checked'],
    alwaysShowResizeHandle: ['setting-always-show-resize-handle', 'change', 'checked'],
    alwaysShowMenuIcon: ['setting-always-show-menu-icon', 'change', 'checked'],
    desktopBackgroundColor: ['setting-background-color', 'input', 'value'],
    defaultTileBackgroundColor: ['setting-default-tile-background-color', 'input', 'value'],
    defaultLinkTextColor: ['setting-default-link-text-color', 'input', 'value'],
    desktopTextSize: ['setting-desktop-text-size', 'input', 'value'],
    gridColumns: ['setting-grid-columns', 'input', 'value'],
    tileBackgroundTransparency: ['setting-tile-transparency', 'input', 'value']
};

export function normalizeSettings(settings = {}) {
    settings = settings || {};
    return {
        ...defaultSettings,
        ...settings,
        gridColumns: normalizeGridColumns(settings.gridColumns),
        desktopTextSize: normalizeDesktopTextSize(settings.desktopTextSize)
    };
}

export function createSettings() {
    // Keep a stable object so consumers always read the latest settings.
    const globalSettings = { ...defaultSettings };
    let desktop;
    let saveTimer;
    const elements = Object.fromEntries(Object.entries(controls).map(([key, [id]]) => [key, document.getElementById(id)]));
    const backgroundImageInput = document.getElementById('setting-background-image');

    function renderSettingsControls() {
        for (const [key, [, , property]] of Object.entries(controls)) {
            elements[key][property] = globalSettings[key];
        }
        document.getElementById('setting-desktop-text-size-value').textContent = globalSettings.desktopTextSize;
        document.getElementById('setting-grid-columns-value').textContent = globalSettings.gridColumns;
        document.getElementById('setting-tile-transparency-value').textContent = `${globalSettings.tileBackgroundTransparency}%`;
    }

    function applySettings(keys, saveTiles = false) {
        const changed = key => keys.includes(key);
        if (changed('desktopBackgroundColor')) document.body.style.backgroundColor = globalSettings.desktopBackgroundColor;
        if (changed('desktopTextSize')) document.body.style.fontSize = `${globalSettings.desktopTextSize}px`;
        if (changed('alwaysShowMenuIcon')) document.body.classList.toggle('always-show-menu-icon', globalSettings.alwaysShowMenuIcon);
        if (changed('gridColumns') && desktop.grid.getColumn() !== globalSettings.gridColumns) {
            desktop.grid.column(globalSettings.gridColumns, 'move');
            if (typeof desktop.grid.onResize === 'function') desktop.grid.onResize();
            if (saveTiles) desktop.saveLayout();
        }
        if (changed('alwaysShowResizeHandle')) {
            desktop.grid.opts.alwaysShowResizeHandle = globalSettings.alwaysShowResizeHandle;
            desktop.grid.getGridItems().forEach(item => desktop.grid.prepareDragDrop(item, true));
        }
        if (changed('defaultTileBackgroundColor') || changed('tileBackgroundTransparency')) desktop.applyTileTransparencyToAllTiles();
        if (changed('defaultLinkTextColor')) desktop.applyDefaultLinkTextColorToBookmarkTiles();
    }

    function saveSettings() {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        persist({ globalSettings: { ...globalSettings } });
    }

    function updateSettings(patch, { defer = false } = {}) {
        Object.assign(globalSettings, normalizeSettings({ ...globalSettings, ...patch }));
        renderSettingsControls();
        applySettings(Object.keys(patch), true);
        clearTimeout(saveTimer);
        if (defer) saveTimer = setTimeout(saveSettings, 120);
        else saveSettings();
    }

    function clearImage() {
        clearDesktopBackgroundImage();
        removeCachedDesktopBackgroundImage();
        backgroundImageInput.value = '';
        storageRemove('desktopBackgroundImage').catch(reportStorageError);
    }

    async function initialize(desktopController) {
        desktop = desktopController;
        const data = await storageGet('globalSettings');
        Object.assign(globalSettings, normalizeSettings(data.globalSettings));
        renderSettingsControls();
        applySettings(Object.keys(controls));

        for (const [key, [, event, property]] of Object.entries(controls)) {
            elements[key].addEventListener(event, () => updateSettings({
                [key]: key === 'tileBackgroundTransparency' ? Number(elements[key][property]) : elements[key][property]
            }, { defer: event === 'input' }));
            if (event === 'input') elements[key].addEventListener('change', saveSettings);
        }
        window.addEventListener('pagehide', () => {
            if (saveTimer !== undefined) saveSettings();
        });
        backgroundImageInput.addEventListener('change', event => {
            const file = event.target.files[0];
            if (!file || file.size > 2.5 * 1024 * 1024) {
                alert('Image too large (max 2.5 MB)');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                applyDesktopBackgroundImage(reader.result);
                cacheDesktopBackgroundImage(reader.result);
                persist({ desktopBackgroundImage: reader.result });
            };
            reader.readAsDataURL(file);
        });
        document.getElementById('clear-background').addEventListener('click', () => {
            clearImage();
            updateSettings({ desktopBackgroundColor: defaultSettings.desktopBackgroundColor });
        });
        document.getElementById('reset-settings').addEventListener('click', () => {
            clearImage();
            updateSettings(defaultSettings);
        });
    }

    return { globalSettings, initialize };
}
