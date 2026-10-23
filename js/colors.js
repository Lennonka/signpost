import { FALLBACK_TILE_BACKGROUND_COLOR } from './model.js';

export function colorToRgba(color, alpha) {
    if (!color) color = FALLBACK_TILE_BACKGROUND_COLOR;

    const rgbComponents = colorToRgbComponents(color);
    if (rgbComponents) {
        return `rgba(${rgbComponents.r}, ${rgbComponents.g}, ${rgbComponents.b}, ${alpha})`;
    }

    return color;
}

export function colorToRgbComponents(color) {
    if (!color) color = FALLBACK_TILE_BACKGROUND_COLOR;

    const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        let value = hex[1];
        if (value.length === 3) {
            value = value.split('').map(char => char + char).join('');
        }
        const intValue = parseInt(value, 16);
        const r = (intValue >> 16) & 255;
        const g = (intValue >> 8) & 255;
        const b = intValue & 255;
        return { r, g, b };
    }

    const rgb = color.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
        return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    }

    return null;
}

export function normalizeColorPickerValue(color) {
    const match = String(color || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return '';

    let value = match[1];
    if (value.length === 3) {
        value = value.split('').map(char => char + char).join('');
    }

    return `#${value.toLowerCase()}`;
}

export function mixChannel(value, target, amount) {
    return Math.round(value + (target - value) * amount);
}

export function getScrollbarColors(color) {
    const rgb = colorToRgbComponents(color);
    if (!rgb) {
        return { thumb: '', track: '' };
    }

    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const target = luminance > 0.55 ? 0 : 255;
    const amount = 0.28;
    const r = mixChannel(rgb.r, target, amount);
    const g = mixChannel(rgb.g, target, amount);
    const b = mixChannel(rgb.b, target, amount);

    return {
        thumb: `rgba(${r}, ${g}, ${b}, 0.32)`,
        track: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`
    };
}

export function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}
