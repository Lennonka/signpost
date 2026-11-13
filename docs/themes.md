# Themes

Settings → Themes offers four built-in palettes: two light themes, Daylight (pale blue and white) and Linen (cream and terracotta), and two dark themes, Midnight (navy and silver) and Aubergine (deep purple and lavender). Selecting one applies and saves it immediately. Text size, grid columns, behavior preferences, bookmarks, tile positions, and individual tile color overrides are preserved. Existing custom tile backgrounds still receive the theme's global tile transparency.

The [JSON Schema](themes.schema.json) describes the theme file format. Import theme accepts the separate JSON format described below; configuration backups remain unchanged and belong in Settings → Backup.

```json
{
  "format": "signpost-theme",
  "version": 1,
  "name": "My theme",
  "settings": {
    "desktopBackgroundColor": "#141824",
    "desktopBackgroundOverlay": "solid",
    "desktopBackgroundTransparency": 0,
    "defaultTileBackgroundColor": "#252b3d",
    "defaultLinkTextColor": "#e5e9f0",
    "defaultFolderTitleColor": "#ffffff",
    "tileBackgroundTransparency": 20
  }
}
```

`format`, `version`, `name`, and `settings` are required. Name is a nonblank string of at most 100 characters. An optional `description` accepts at most 300 characters. Unknown fields and settings are rejected, including text size and layout preferences.

All appearance settings are optional. Missing settings use the application's defaults, independent of the current desktop. Supported fields:

- `desktopBackgroundColor`, `desktopBackgroundEndColor`, `defaultTileBackgroundColor`, `defaultLinkTextColor`, `defaultFolderTitleColor`: six-digit hex colors.
- `desktopBackgroundOverlay`: `solid` or `gradient`.
- `desktopBackgroundDirection`: one of the eight directions documented in [configuration backups](config.md).
- `desktopBackgroundTransparency`, `tileBackgroundTransparency`: integers from 0 (opaque) to 100 (transparent).
- `desktopBackgroundImage`: optional base64 image data URL, or `null` to clear the wallpaper. Omitting it preserves the current image. Built-in themes omit it.

Theme versions are independent of extension and backup versions. Imports validate the complete file before saving; importing a theme does not access browser bookmarks or write tiles.

Palette updates do not overwrite saved appearance. Reapply a built-in theme to use its current colors. Older theme files still import their original colors.
