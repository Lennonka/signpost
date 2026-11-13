import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInThemes, validateTheme, themeKeys } from '../js/themes.js';
import { defaultSettings } from '../js/model.js';

test('four complete presets contain appearance settings only', () => {
    assert.equal(builtInThemes.length, 4);
    for (const theme of builtInThemes) {
        assert.deepEqual(Object.keys(validateTheme(theme).settings).sort(), [...themeKeys].sort());
        assert.equal(Object.hasOwn(theme.settings, 'desktopTextSize'), false);
    }
});
test('partial themes use defaults and reject settings outside appearance', () => {
    const theme = { format: 'signpost-theme', version: 1, name: 'Partial', settings: {} };
    assert.equal(validateTheme(theme).settings.defaultLinkTextColor, defaultSettings.defaultLinkTextColor);
    for (const settings of [{ desktopTextSize: 20 }, { gridColumns: 12 }, { defaultLinkTextColor: 'red' },
        { desktopBackgroundTransparency: 101 }, { desktopBackgroundDirection: 'sideways' },
        { desktopBackgroundImage: 'https://example.com/image.png' }, { tiles: [] }]) {
        assert.throws(() => validateTheme({ ...theme, settings }));
    }
    assert.throws(() => validateTheme({ ...theme, version: 2 }));
    assert.throws(() => validateTheme({ ...theme, format: 'signpost' }));
});
