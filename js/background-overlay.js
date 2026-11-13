import { colorToRgba, colorToRgbComponents } from './colors.js';

export const overlayDirections = {
    'to top': '↑ Bottom to top',
    'to top right': '↗ Bottom left to top right',
    'to right': '→ Left to right',
    'to bottom right': '↘ Top left to bottom right',
    'to bottom': '↓ Top to bottom',
    'to bottom left': '↙ Top right to bottom left',
    'to left': '← Right to left',
    'to top left': '↖ Bottom right to top left'
};

export function getDefaultOverlayEndColor(color) {
    const rgb = colorToRgbComponents(color);
    const brightness = rgb ? (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 : 1;
    return brightness > 0.5 ? '#000000' : '#ffffff';
}

export function applyBackgroundOverlay(settings) {
    const alpha = 1 - settings.desktopBackgroundTransparency / 100;
    const start = colorToRgba(settings.desktopBackgroundColor, alpha);
    const gradient = settings.desktopBackgroundOverlay === 'gradient';
    document.body.style.backgroundColor = gradient ? 'transparent' : start;
    document.body.style.backgroundImage = gradient
        ? `linear-gradient(${settings.desktopBackgroundDirection}, ${start}, ${colorToRgba(settings.desktopBackgroundEndColor, alpha)})`
        : '';
}
