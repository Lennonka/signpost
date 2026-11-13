# Signpost

A Chrome extension that turns the new tab page into a bookmark desktop. Load this directory as an unpacked extension through Chrome's extension developer mode. There is no build step or runtime framework.

## Code structure

- `signpost.js` wires together startup, initial setup, and the desktop UI.
- `js/desktop.js` owns GridStack, tile geometry, cached layout rendering, and bookmark refresh.
- `js/tiles.js` renders bookmarks and folders and applies their appearance.
- `js/tile-actions.js` delegates desktop interactions and owns the active menu and color picker.
- `js/settings.js` loads, normalizes, renders, and updates settings. Slider and color inputs apply immediately and batch settings writes until a pause or the final change event.
- `js/bookmark-picker.js` renders and filters the bookmark selection tree.
- `js/bookmarks.js`, `js/chrome-api.js`, and `js/storage.js` wrap Chrome APIs with consistent errors.
- `js/model.js`, `js/colors.js`, and `js/placement.js` contain shared data transformations and helpers.
- `js/ui.js` handles toolbar buttons, modals, and messages.
- `background-image-startup.js` paints the cached wallpaper before the module graph loads. `js/background-image.js` synchronizes the wallpaper with extension storage.
- `background.js` handles popup messages, context menus, and active-tab bookmark status.

The page, popup, and service worker use native ES modules. GridStack remains the vendored classic script.

## State and persistence

Existing `chrome.storage.local` keys and tile records remain compatible. GridStack nodes hold tile geometry, colors, and bookmark snapshots; serialization does not read appearance from DOM styles.

The background worker owns all writes to `tiles`. Desktop pages send field changes and explicit removals through `js/layout-client.js`. The worker applies these changes to the latest stored layout through a shared queue in `js/layout-store.js`, also used by popup and context-menu additions. Independent changes from stale tabs preserve unrelated fields and tiles. Concurrent changes to the same field use the last processed update. New tiles added through the popup, context menus, or another desktop appear in open desktops through storage change notifications. Changes to existing tiles from another desktop appear after reloading.

Startup renders cached snapshots before refreshing from one bookmark-tree read. A failed read retains cached tiles and preserves legacy tile records without snapshots. A successful read removes tiles for bookmarks that no longer exist.

In Settings → Configure → Tiles, **Default folder title color** appears after **Default tile color** and defaults to black. It updates folder titles immediately while preserving individual title color overrides.

## Desktop background

In Settings → Configure, choose a **Background image** first, then a **Background overlay color**. The color is painted above the image. **Background overlay transparency** defaults to 50%; 0% hides the image with an opaque color, and 100% shows the image without the overlay. Changes apply immediately and persist after reload. Clearing the background removes the image and resets the overlay color and transparency.

Existing saved colors now apply as overlays over existing images, with 50% transparency when no value was saved. No data migration is needed.

## Configuration backup

In Settings → Backup, choose **Export to JSON** to download settings, wallpaper, and the current tile layout. Use **Import from JSON** in the same tab to restore a backup after confirmation. Import replaces settings and layout, matching existing bookmarks by URL and folders by title path; unresolved references abort the import. Bookmark tiles use URLs rather than browser IDs. See the [format documentation](docs/config.md) and [JSON Schema](docs/config.schema.json).

## Checks

Use Node.js 22 or newer:

```sh
node tests/config.test.mjs
node tests/model.test.mjs
node tests/layout.test.mjs
node tests/background.test.mjs
node tests/browser.test.mjs
```

The browser test needs Chrome (`google-chrome`, or set `CHROME_BIN`) and permission to start a loopback HTTP server. It uses a temporary browser profile, the real vendored GridStack, and mocked Chrome APIs. It does not access your browser profile or bookmarks.

For an installed-extension check, reload the extension and open a new tab. Verify:

1. Start empty and import the Bookmarks Bar on a fresh profile.
2. Add bookmarks from the picker, popup, and page/link context menus.
3. Drag and resize tiles, reload, and check saved geometry and colors.
4. Open child folders, search the picker, and try duplicate additions.
5. Change settings, reset defaults, upload and clear wallpaper, and reload.
6. Edit separate tiles in two open desktops and confirm both changes survive reloading.
7. Rename or delete a bookmark and reload to refresh its tile.
