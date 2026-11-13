# JSON configuration backup

Open Settings → Backup and select **Export to JSON** to download `signpost-YYYY-MM-DD.json` (UTC date). Export captures the current desktop layout and settings, including recent edits and the uploaded wallpaper. Select **Import from JSON** in the same tab to restore a backup.

The machine-readable contract is [config.schema.json](config.schema.json), using JSON Schema draft 2020-12. The top-level `format` is always `signpost`; `version: 1` identifies this contract. `exportedAt` is an ISO 8601 UTC timestamp.

Example tile records within an export:

```json
{
  "format": "signpost",
  "version": 1,
  "exportedAt": "2026-10-23T12:00:00.000Z",
  "settings": {
    "openInNewTab": false,
    "confirmBeforeRemove": false,
    "gridColumns": 18,
    "desktopBackgroundColor": "#ffffff",
    "desktopBackgroundTransparency": 50,
    "desktopTextSize": 14,
    "defaultTileBackgroundColor": "#dbdbdb",
    "defaultLinkTextColor": "#0000ee",
    "defaultFolderTitleColor": "#000000",
    "desktopBackgroundImage": null,
    "tileBackgroundTransparency": 50,
    "alwaysShowResizeHandle": false,
    "alwaysShowMenuIcon": false
  },
  "tiles": [
    {
      "type": "bookmark",
      "url": "https://example.com/",
      "x": 0, "y": 0, "w": 1, "h": 1,
      "backgroundColor": "", "textColor": ""
    },
    {
      "type": "folder",
      "path": ["Bookmarks Bar", "Work"],
      "x": 1, "y": 0, "w": 2, "h": 2,
      "backgroundColor": "#abcdef", "textColor": "#123456"
    }
  ]
}
```

Bookmark identity is the exact stored URL, including query strings and fragments, without normalization. Browser bookmark IDs, cached HTML, and snapshots are excluded. `tiles` is an array so multiple bookmarks sharing the same URL retain separate layout records; a URL does not uniquely identify a bookmark when duplicates exist.

Folders have no URL. Their fallback identity is an ordered array of folder titles from the browser's top-level bookmark folder to the tile's folder, excluding the invisible root. Paths depend on titles and can be ambiguous for identically named siblings or differ across browser languages. Import rejects ambiguous folder paths. Folder contents and the full bookmark tree are not exported; this file backs up Signpost configuration, not browser bookmarks.

Coordinates `x` and `y` are zero-based grid cells; `w` and `h` are positive cell counts. `settings.gridColumns` gives the grid width. Tile colors are hexadecimal overrides; an empty string uses the default appearance. `defaultFolderTitleColor` controls folder titles without a per-tile text color override; it defaults to black (`#000000`) when omitted in older backups. Settings contain all current user-facing controls; the unused legacy `tileSize` is omitted. `desktopBackgroundImage` is the stored image data URL, or `null`. `desktopBackgroundColor` is the overlay above the image. `desktopBackgroundTransparency` ranges from 0 (opaque) to 100 (fully transparent), defaulting to 50 when omitted in older backups. Existing saved colors now act as overlays; no data migration is required. New exports include the transparency field and require a version of Signpost that supports it.

Export reads the bookmark tree to resolve current URLs and folder paths. A cached URL can resolve a missing bookmark tile. An unidentifiable tile or failed bookmark/storage read aborts the download and displays an error, preventing silent loss of layout records.

## Import behavior

Import validates the version 1 format, settings, image data URL, colors, and tile geometry before making changes. Tiles must fit the configured column count. Unsupported versions and invalid files display an error in Backup.

Bookmark tiles match exact URLs in the current bookmark tree. When multiple bookmarks share a URL, successive tile records consume distinct matches in tree order. Folder tiles match exact title paths; ambiguous folder paths are rejected. Missing bookmarks or insufficient duplicate matches abort the entire import. Import never creates, edits, or deletes browser bookmarks.

After validation and matching, confirmation explains that import replaces settings, wallpaper, and the entire tile layout. Cancel leaves the configuration unchanged. The worker revalidates and resolves bookmarks, then writes the replacement through the shared layout queue in one storage operation. A storage failure reports an error. Successful import reloads open Signpost desktops and clears pending settings timers to avoid saving their previous settings during reload. An empty tile list restores an empty desktop.

### Import errors and manual testing

Validation reports the first invalid field using a path such as `settings.gridColumns` or `tiles[0].url` (tile indexes start at zero). Errors identify missing or unknown fields, expected values, and the actual invalid value. Long values are shortened in the message. Invalid JSON syntax is reported separately from configuration validation; bookmark matching errors remain separate. Failed imports also state that the configuration has not been changed.

For a manual check, import [`tests/config-invalid.json`](../tests/config-invalid.json). It is valid JSON with an invalid `settings.gridColumns` value of `50`; the message should explain that the allowed range is 6–36. To test malformed JSON, use [`tests/config-invalid-syntax.json`](../tests/config-invalid-syntax.json), which has a trailing comma. Both files should fail before confirmation or configuration replacement.
