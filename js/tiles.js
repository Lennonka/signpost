import { FALLBACK_TILE_BACKGROUND_COLOR, DEFAULT_LINK_TEXT_COLOR, DEFAULT_FOLDER_TITLE_COLOR } from './model.js';
import { colorToRgba, getScrollbarColors, escapeHTML } from './colors.js';
import { getFavicon } from './favicon.js';

export function createTileRenderer(globalSettings) {
    function getTileAlpha() {
        return 1 - (Number(globalSettings.tileBackgroundTransparency) || 0) / 100;
    }

    function getDefaultTileBackgroundColor() {
        return globalSettings.defaultTileBackgroundColor || FALLBACK_TILE_BACKGROUND_COLOR;
    }

    function getDefaultLinkTextColor() {
        return globalSettings.defaultLinkTextColor || DEFAULT_LINK_TEXT_COLOR;
    }

    function getDefaultFolderTitleColor() {
        return globalSettings.defaultFolderTitleColor || DEFAULT_FOLDER_TITLE_COLOR;
    }

    function applyTileBackground(tileEl, baseColor) {
        const content = tileEl?.querySelector('.tile');
        if (!content) return;

        const color = baseColor || getDefaultTileBackgroundColor();
        const tileBackground = colorToRgba(color, getTileAlpha());
        const header = content.querySelector('.tile-header');
        const scrollbarColors = getScrollbarColors(color);
        content.dataset.baseBackgroundColor = color;
        content.style.backgroundColor = tileBackground;
        content.style.setProperty('--tile-scrollbar-thumb', scrollbarColors.thumb);
        content.style.setProperty('--tile-scrollbar-track', scrollbarColors.track);
        if (header) {
            header.style.backgroundColor = content.classList.contains('folder-tile') ? tileBackground : '';
        }
    }

    function applyFolderTitleColor(tileEl, color) {
        const title = tileEl?.querySelector('.folder-title');
        if (title) title.style.color = color || getDefaultFolderTitleColor();
    }

    function applyBookmarkLinkTextColor(tileEl, color) {
        const tile = tileEl?.querySelector('.tile');
        if (!tile || tile.classList.contains('folder-tile')) return;

        const linkTextColor = color || getDefaultLinkTextColor();
        tile.querySelectorAll('.bookmark-link, .bookmark-title').forEach(el => {
            el.style.color = linkTextColor;
        });
    }

    function buildTileHTML(bookmark) {
        let tileHeaderHTML;
        let tileBodyHTML;
        let tileHeaderTitleText;
        const openTarget = globalSettings.openInNewTab ? '_blank' : '_self';

        if (!bookmark.url) { // FOLDERS
            let childListHTML = '';
            const children = bookmark.children || [];
            children.forEach(child => {
                let contentHTML = '';
                if (child.url) {
                    // Bookmark link
                    const faviconURL = getFavicon(child.url, 16);
                    contentHTML = `
      <a class="bookmark-link" href="${escapeHTML(child.url)}" title="${escapeHTML(child.title)}" target="${openTarget}">
        <img class="favicon" src="${escapeHTML(faviconURL)}" loading="lazy" decoding="async"/>
      </a>
      `;
                } else {
                    // Folder
                    contentHTML = `
      <span class="bookmark-link bookmark-folder" title="${escapeHTML(child.title)}" data-id="${escapeHTML(child.id)}">📁</span>
      `;
                }
                childListHTML += `
      <div class="bookmark-item">
        ${contentHTML}
      </div>
    `;
            });
            tileHeaderTitleText = escapeHTML(bookmark.title);
            tileBodyHTML = `
              <div class="tile-body folder-content">
                ${childListHTML}
              </div>
              `;
        } else { // LINKS
            const faviconURL = getFavicon(bookmark.url, 64);
            tileHeaderTitleText = "";
            tileBodyHTML = `
              <div class="tile-body center">
                <a class="bookmark-link" href="${escapeHTML(bookmark.url)}" title="${escapeHTML(bookmark.title)}" target="${openTarget}">
                    <img class="favicon-large" src="${escapeHTML(faviconURL)}" decoding="async"/>
                    <div class="bookmark-title">${escapeHTML(bookmark.title)}</div>
                </a>
              </div>
              `;
        }
        const textColorItem = bookmark.url
            ? `<div class="tile-menu-item set-link-text-color">Set link text color</div>`
            : `<div class="tile-menu-item set-text-color">Set title color</div>`;
        tileHeaderHTML = `
            <div class="tile-header">
                <div class="folder-title">${tileHeaderTitleText}</div>
                <div class="tile-menu-icon" tabindex="0">⁝
                    <div class="tile-menu hidden">
                        <div class="tile-menu-item remove-tile">Remove</div>
                        <div class="tile-menu-item set-bg-color">Set background color</div>
                        <div class="tile-menu-item reset-bg-color">Reset background</div>
                        ${textColorItem}
                    </div>
                </div>
            </div>
            `;
        const tileHTML = `
            <div class="tile${bookmark.url ? '' : ' folder-tile'}">
            ${tileHeaderHTML}
            ${tileBodyHTML}
            </div>
        `;
        return tileHTML;
    }

    return { getDefaultTileBackgroundColor, getDefaultLinkTextColor, getDefaultFolderTitleColor,
        applyTileBackground, applyFolderTitleColor, applyBookmarkLinkTextColor, buildTileHTML };
}
