# JSON export

Open Settings and select **Export to JSON** to download `signpost-YYYY-MM-DD.json` (UTC date). Export captures the current desktop layout and settings, including recent edits and the uploaded wallpaper. Import is not implemented.

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
    "desktopTextSize": 14,
    "defaultTileBackgroundColor": "#dbdbdb",
    "defaultLinkTextColor": "#0000ee",
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

Folders have no URL. Their fallback identity is an ordered array of folder titles from the browser's top-level bookmark folder to the tile's folder, excluding the invisible root. Paths depend on titles and can be ambiguous for identically named siblings or differ across browser languages. A future importer must handle these ambiguities explicitly. Folder contents and the full bookmark tree are not exported; this file backs up Signpost configuration, not browser bookmarks.

Coordinates `x` and `y` are zero-based grid cells; `w` and `h` are positive cell counts. `settings.gridColumns` gives the grid width. Tile colors are hexadecimal overrides; an empty string uses the default appearance. Settings contain all current user-facing controls; the unused legacy `tileSize` is omitted. `desktopBackgroundImage` is the stored image data URL, or `null`.

Export reads the bookmark tree to resolve current URLs and folder paths. A cached URL can resolve a missing bookmark tile. An unidentifiable tile or failed bookmark/storage read aborts the download and displays an error, preventing silent loss of layout records.
