import { bindThemes } from './themes.js';
import { storageSet } from './storage.js';
import { applyBackgroundOverlay, overlayDirections, getDefaultOverlayEndColor } from './background-overlay.js';
import { openColorPicker } from './color-picker.js';
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
    desktopBackgroundEndColor: ['setting-background-end-color', 'input', 'value'],
    desktopBackgroundTransparency: ['setting-background-transparency', 'input', 'value'],
    defaultTileBackgroundColor: ['setting-default-tile-background-color', 'input', 'value'],
    defaultLinkTextColor: ['setting-default-link-text-color', 'input', 'value'],
    defaultFolderTitleColor: ['setting-default-folder-title-color', 'input', 'value'],
    desktopTextSize: ['setting-desktop-text-size', 'input', 'value'],
    gridColumns: ['setting-grid-columns', 'input', 'value'],
    tileBackgroundTransparency: ['setting-tile-transparency', 'input', 'value']
};

export function normalizeSettings(settings = {}) {
    settings = settings || {};
    return {
        ...defaultSettings,
        ...settings,
        desktopBackgroundOverlay: settings.desktopBackgroundOverlay === 'gradient' ? 'gradient' : 'solid',
        desktopBackgroundDirection: Object.hasOwn(overlayDirections, settings.desktopBackgroundDirection)
            ? settings.desktopBackgroundDirection : defaultSettings.desktopBackgroundDirection,
        desktopBackgroundEndColor: settings.desktopBackgroundEndColor || getDefaultOverlayEndColor(settings.desktopBackgroundColor || defaultSettings.desktopBackgroundColor),
        desktopBackgroundTransparency: Number.isFinite(Number(settings.desktopBackgroundTransparency)) && settings.desktopBackgroundTransparency != null
            ? Math.min(100, Math.max(0, Math.round(Number(settings.desktopBackgroundTransparency))))
            : defaultSettings.desktopBackgroundTransparency,
        gridColumns: normalizeGridColumns(settings.gridColumns),
        desktopTextSize: normalizeDesktopTextSize(settings.desktopTextSize)
    };
}

export function createSettings() {
    // Keep a stable object so consumers always read the latest settings.
    const globalSettings = { ...defaultSettings };
    let desktop;
    let saveTimer;
    let refreshThemeSelection = () => {};
    const elements = Object.fromEntries(Object.entries(controls).map(([key, [id]]) => [key, document.getElementById(id)]));
    const overlayButton = document.getElementById('setting-overlay-mode');
    const overlayOptions = document.getElementById('overlay-options');
    const backgroundImageInput = document.getElementById('setting-background-image');

    function renderSettingsControls() {
        refreshThemeSelection();
        const gradient = globalSettings.desktopBackgroundOverlay === 'gradient';
        document.getElementById('overlay-start-label').textContent = gradient ? 'Start color' : 'Background overlay color';
        document.getElementById('overlay-end-row').hidden = !gradient;
        overlayButton.textContent = gradient ? overlayDirections[globalSettings.desktopBackgroundDirection] : 'Solid color';
        overlayOptions.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.direction
                ? gradient && button.dataset.direction === globalSettings.desktopBackgroundDirection : !gradient));
        });
        for (const [key, [, , property]] of Object.entries(controls)) {
            elements[key][property] = globalSettings[key];
            if (elements[key].classList.contains('color-swatch')) {
                elements[key].style.backgroundColor = globalSettings[key];
                const name = elements[key].closest('label').querySelector('strong').textContent;
                elements[key].setAttribute('aria-label', `${name}: ${globalSettings[key]}`);
            }
        }
        document.getElementById('setting-desktop-text-size-value').textContent = globalSettings.desktopTextSize;
        document.getElementById('setting-grid-columns-value').textContent = globalSettings.gridColumns;
        document.getElementById('setting-background-transparency-value').textContent = `${globalSettings.desktopBackgroundTransparency}%`;
        document.getElementById('setting-tile-transparency-value').textContent = `${globalSettings.tileBackgroundTransparency}%`;
    }

    function applySettings(keys, saveTiles = false) {
        const changed = key => keys.includes(key);
        if (keys.some(key => ['desktopBackgroundColor', 'desktopBackgroundEndColor', 'desktopBackgroundTransparency',
            'desktopBackgroundOverlay', 'desktopBackgroundDirection'].includes(key))) applyBackgroundOverlay(globalSettings);
        if (changed('desktopTextSize')) document.getElementById('desktop').style.fontSize = `${globalSettings.desktopTextSize}px`;
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
        if (changed('defaultFolderTitleColor')) desktop.applyDefaultFolderTitleColorToFolderTiles();
        if (changed('defaultLinkTextColor')) desktop.applyDefaultLinkTextColorToBookmarkTiles();
    }

    function saveSettings() {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        return persist({ globalSettings: { ...globalSettings } });
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

        refreshThemeSelection = bindThemes({ globalSettings, async applyTheme(themeSettings) {
            const { desktopBackgroundImage, ...appearance } = themeSettings;
            clearTimeout(saveTimer);
            saveTimer = undefined;
            const nextSettings = normalizeSettings({ ...globalSettings, ...appearance });
            const data = { globalSettings: nextSettings };
            if (desktopBackgroundImage !== undefined) data.desktopBackgroundImage = desktopBackgroundImage;
            await storageSet(data);
            Object.assign(globalSettings, nextSettings);
            renderSettingsControls();
            applySettings(Object.keys(appearance));
            if (desktopBackgroundImage !== undefined) {
                if (desktopBackgroundImage === null) {
                    clearDesktopBackgroundImage();
                    removeCachedDesktopBackgroundImage();
                } else {
                    applyDesktopBackgroundImage(desktopBackgroundImage);
                    cacheDesktopBackgroundImage(desktopBackgroundImage);
                }
                backgroundImageInput.value = '';
            }
        } });

        for (const [key, [, event, property]] of Object.entries(controls)) {
            if (elements[key].classList.contains('color-swatch')) {
                elements[key].addEventListener('click', () => openColorPicker({
                    trigger: elements[key],
                    getAnchorRect: () => elements[key].getBoundingClientRect(),
                    placement: 'left',
                    label: elements[key].closest('label').querySelector('strong').textContent,
                    initialColor: globalSettings[key],
                    onChange: color => updateSettings({ [key]: color }, { defer: true }),
                    onCommit: saveSettings
                }));
                continue;
            }
            elements[key].addEventListener(event, () => updateSettings({
                [key]: key.endsWith('Transparency') ? Number(elements[key][property]) : elements[key][property]
            }, { defer: event === 'input' }));
            if (event === 'input') elements[key].addEventListener('change', saveSettings);
        }
        function closeOverlayOptions() {
            overlayOptions.hidden = true;
            overlayButton.setAttribute('aria-expanded', 'false');
        }
        overlayButton.addEventListener('click', () => {
            overlayOptions.hidden = !overlayOptions.hidden;
            overlayButton.setAttribute('aria-expanded', String(!overlayOptions.hidden));
            if (!overlayOptions.hidden) overlayOptions.querySelector('[aria-pressed="true"]').focus();
        });
        overlayOptions.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            updateSettings(button.dataset.direction
                ? { desktopBackgroundOverlay: 'gradient', desktopBackgroundDirection: button.dataset.direction }
                : { desktopBackgroundOverlay: 'solid' });
            closeOverlayOptions();
            overlayButton.focus();
        });
        document.addEventListener('click', event => {
            if (!event.target.closest('.overlay-mode-setting')) closeOverlayOptions();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !overlayOptions.hidden) {
                closeOverlayOptions();
                overlayButton.focus();
            }
        });
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
            updateSettings({
                desktopBackgroundColor: defaultSettings.desktopBackgroundColor,
                desktopBackgroundTransparency: defaultSettings.desktopBackgroundTransparency,
                desktopBackgroundOverlay: defaultSettings.desktopBackgroundOverlay,
                desktopBackgroundDirection: defaultSettings.desktopBackgroundDirection,
                desktopBackgroundEndColor: defaultSettings.desktopBackgroundEndColor
            });
        });
        document.getElementById('reset-settings').addEventListener('click', () => {
            if (!confirm('Reset all settings to defaults and remove the background image? This action is irreversible. Your tile layout will remain in place.')) return;
            clearImage();
            updateSettings(defaultSettings);
        });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.configRevision) {
            clearTimeout(saveTimer);
            saveTimer = undefined;
        }
    });
    return { globalSettings, initialize, flush: saveSettings };
}
