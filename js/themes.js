import { defaultSettings } from './model.js';
import { overlayDirections } from './background-overlay.js';

export const themeKeys = [
    'desktopBackgroundColor', 'desktopBackgroundOverlay', 'desktopBackgroundDirection',
    'desktopBackgroundEndColor', 'desktopBackgroundTransparency', 'defaultTileBackgroundColor',
    'defaultLinkTextColor', 'defaultFolderTitleColor', 'tileBackgroundTransparency'
];
const defaults = Object.fromEntries(themeKeys.map(key => [key, defaultSettings[key]]));

function preset(name, description, start, end, tile, text, title, direction) {
    return { format: 'signpost-theme', version: 1, name, description, settings: {
        ...defaults, desktopBackgroundColor: start, desktopBackgroundEndColor: end,
        desktopBackgroundOverlay: 'gradient', desktopBackgroundDirection: direction,
        desktopBackgroundTransparency: 0, defaultTileBackgroundColor: tile,
        defaultLinkTextColor: text, defaultFolderTitleColor: title, tileBackgroundTransparency: 12
    } };
}

export const builtInThemes = [
    preset('Daylight', 'Pale blue skies and crisp white', '#edf6ff', '#c6dcf2', '#ffffff', '#244568', '#244568', 'to bottom right'),
    preset('Midnight', 'Deep navy and cool silver', '#101725', '#253653', '#405574', '#e4edff', '#c4d9ff', 'to bottom'),
    preset('Linen', 'Warm cream and terracotta', '#faf1e2', '#e8d6bc', '#fffaf0', '#704332', '#874b35', 'to bottom right'),
    preset('Aubergine', 'Deep purple and soft lavender', '#21192e', '#392b4d', '#65517f', '#f5edff', '#e5cfff', 'to top right')
];

export function validateTheme(theme) {
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(theme)) throw new Error('Theme must be an object.');
    for (const key of Object.keys(theme)) {
        if (!['format', 'version', 'name', 'description', 'settings'].includes(key)) throw new Error(`Unknown theme field: ${key}.`);
    }
    if (theme.format !== 'signpost-theme') throw new Error('Expected a Signpost theme file.');
    if (theme.version !== 1) throw new Error('Unsupported theme version; expected version 1.');
    if (typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 100) throw new Error('Theme name must contain 1–100 characters.');
    if (theme.description !== undefined && (typeof theme.description !== 'string' || theme.description.length > 300)) throw new Error('Theme description must be a string of at most 300 characters.');
    if (!object(theme.settings)) throw new Error('Theme settings must be an object.');
    for (const [key, value] of Object.entries(theme.settings)) {
        if (![...themeKeys, 'desktopBackgroundImage'].includes(key)) throw new Error(`Unknown theme setting: ${key}.`);
        let valid;
        if (key === 'desktopBackgroundOverlay') valid = ['solid', 'gradient'].includes(value);
        else if (key === 'desktopBackgroundDirection') valid = Object.hasOwn(overlayDirections, value);
        else if (key.endsWith('Transparency')) valid = Number.isSafeInteger(value) && value >= 0 && value <= 100;
        else if (key === 'desktopBackgroundImage') valid = value === null || (typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value));
        else valid = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
        if (!valid) throw new Error(`Invalid theme setting: ${key}.`);
    }
    return { ...theme, settings: { ...defaults, ...theme.settings } };
}

export function bindThemes({ globalSettings, applyTheme }) {
    const status = document.getElementById('theme-status');
    const choices = document.getElementById('theme-choices');
    const buttons = [];
    function refreshSelection() {
        builtInThemes.forEach((theme, index) => {
            const selected = themeKeys.every(key => {
                const current = globalSettings[key];
                const expected = theme.settings[key];
                return typeof current === 'string' ? current.toLowerCase() === expected.toLowerCase() : current === expected;
            });
            buttons[index].setAttribute('aria-pressed', String(selected));
        });
    }
    async function apply(theme) {
        try {
            const validated = validateTheme(theme);
            await applyTheme(validated.settings);
            status.textContent = '';
        } catch (error) {
            status.textContent = `Could not apply theme: ${error.message}`;
        }
    }
    for (const theme of builtInThemes) {
        const button = document.createElement('button');
        button.className = 'theme-choice';
        const preview = document.createElement('span');
        preview.className = 'theme-preview';
        preview.style.background = `linear-gradient(${theme.settings.desktopBackgroundDirection}, ${theme.settings.desktopBackgroundColor}, ${theme.settings.desktopBackgroundEndColor})`;
        preview.style.color = theme.settings.defaultLinkTextColor;
        const tile = document.createElement('span');
        tile.textContent = 'Aa';
        tile.style.backgroundColor = theme.settings.defaultTileBackgroundColor;
        preview.append(tile);
        const name = document.createElement('strong');
        name.textContent = theme.name;
        const description = document.createElement('small');
        description.textContent = theme.description;
        button.append(preview, name, description);
        button.addEventListener('click', () => apply(theme));
        choices.append(button);
        buttons.push(button);
    }
    refreshSelection();
    const input = document.getElementById('import-theme');
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            await apply(JSON.parse(await file.text()));
        } catch (error) {
            status.textContent = `Could not import theme: ${error.message}`;
        } finally {
            input.value = '';
        }
    });
    return refreshSelection;
}
