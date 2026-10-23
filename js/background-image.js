import { storageGet } from './storage.js';

const DESKTOP_BACKGROUND_IMAGE_CACHE_KEY = 'signpost.desktopBackgroundImage';

export function applyDesktopBackgroundImage(desktopBackgroundImage) {
    [document.documentElement, document.body].forEach(target => {
        if (!target) return;
        target.style.backgroundImage = `url(${desktopBackgroundImage})`;
        target.style.backgroundSize = 'cover';
        target.style.backgroundPosition = 'center';
        target.style.backgroundRepeat = 'no-repeat';
    });
}

export function clearDesktopBackgroundImage() {
    [document.documentElement, document.body].forEach(target => {
        if (!target) return;
        target.style.backgroundImage = '';
    });
}

export function cacheDesktopBackgroundImage(desktopBackgroundImage) {
    try {
        localStorage.setItem(DESKTOP_BACKGROUND_IMAGE_CACHE_KEY, desktopBackgroundImage);
    } catch (err) {
        console.warn('Could not cache desktop background image for fast startup.', err);
    }
}

export function removeCachedDesktopBackgroundImage() {
    try {
        localStorage.removeItem(DESKTOP_BACKGROUND_IMAGE_CACHE_KEY);
    } catch (err) {
        console.warn('Could not clear cached desktop background image.', err);
    }
}

export async function restoreCachedBackground() {
    try {
        const cached = localStorage.getItem(DESKTOP_BACKGROUND_IMAGE_CACHE_KEY);
        if (cached) applyDesktopBackgroundImage(cached);
    } catch (err) {
        console.warn('Could not read cached desktop background image.', err);
    }
    try {
        const { desktopBackgroundImage } = await storageGet('desktopBackgroundImage');
        if (desktopBackgroundImage) {
            applyDesktopBackgroundImage(desktopBackgroundImage);
            cacheDesktopBackgroundImage(desktopBackgroundImage);
        } else {
            clearDesktopBackgroundImage();
            removeCachedDesktopBackgroundImage();
        }
    } catch (error) {
        console.warn('Could not load desktop background image.', error);
    }
}
