export function getFavicon(url, size = 32) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', url);
    u.searchParams.set('size', String(size));
    return u.toString();
}
