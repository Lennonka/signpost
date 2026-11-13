# Repository instructions

## Project overview

Signpost is a Chrome Manifest V3 extension that replaces the new tab page with a bookmark desktop. It uses plain HTML, CSS, and JavaScript with native ES modules. There is no build step or runtime framework.

- `signpost.html`, `signpost.js`, and `styles.css` define the desktop page.
- `js/` contains desktop, tile, settings, bookmark, storage, and configuration modules. Keep responsibilities in the existing modules; see `README.md` for the module map.
- `background.js` is the module service worker; `action-menu.*` implements the popup.
- `gridstack/` contains the vendored GridStack library. Avoid editing vendored files unless the task requires it.
- `docs/` documents the configuration backup format and its JSON Schema.
- `tests/` contains Node.js checks and a browser integration check.
- `scripts/package.sh` archives runtime files into git-ignored `dist/signpost.zip` using the `zip` utility. Keep its allowlist aligned with extension assets; run `sh scripts/package.sh` after packaging changes.

## Implementation conventions

- Match nearby code: four-space JavaScript indentation, single-quoted strings, semicolons, and explicit `.js` extensions in module imports.
- Keep the extension usable directly as an unpacked extension. Do not introduce a build pipeline or framework without a task requirement.
- Preserve existing storage keys, tile records, and configuration backup compatibility unless a breaking change is explicitly required. Update the format documentation and schema when changing the backup format.
- Keep all writes to `tiles` in the background worker through the shared queue in `js/layout-store.js`. Desktop changes go through `js/layout-client.js` so concurrent tabs preserve unrelated updates.
- Paint the desktop image only on the document root and the translucent solid or gradient overlay on the body so the image remains below the overlay. Keep background transparency defaults, backup validation, and schema aligned; accept older backups that omit transparency or gradient fields, defaulting to Solid mode. Keep gradient direction and end color when switching to Solid.
- Apply default folder title and bookmark link colors only to tiles without a saved text color override. Keep new settings optional in backup imports with their documented defaults.
- Apply tile border colors through the shared tile background renderer using the same color and transparency as folder headers.
- Scope the Text size setting to the desktop tiles. Dialogs, onboarding, and info/error messages must retain their own text sizes.
- Keep “Start from blank desktop” last in onboarding. Respect saved `setupComplete` for empty layouts; an intentionally blank desktop must not reopen first-run setup.
- Use the existing Chrome API wrappers and error-handling patterns. Preserve cached tiles when bookmark reads fail.
- After changes, review and update `README.md` and `AGENTS.md` as needed to keep documented behavior, architecture, setup, validation commands, and agent instructions accurate.

- Keep theme JSON separate from configuration backups. Themes may change colors, overlays, transparency, and optional wallpaper only; preserve text size, layout, preferences, and saved tile color overrides. See `docs/themes.md`.

## Versioning

- Bump `version` in `manifest.json` once per branch when it includes non-documentation changes. Documentation-only changes, including updates to `README.md` and `AGENTS.md`, do not require a version bump.
- Use the existing `MAJOR.MINOR` format. For non-breaking changes, increment the minor version (for example, `4.0` → `4.1`). For breaking changes, increment the major version and reset the minor version to zero (for example, `4.1` → `5.0`).
- Treat incompatible changes to persisted data, backup formats, or existing user-facing behavior as breaking changes. Describe the compatibility impact and any migration steps.
- Before bumping, compare `manifest.json` with the branch's base and check committed and uncommitted changes. If the branch already has a version bump, reuse it for subsequent work instead of incrementing again. If later work introduces a breaking change, adjust that single bump to a major bump relative to the base version. Do not change `manifest_version` as part of a release version bump.

## Validation

Use Node.js 22 or newer. Run the checks relevant to the change; for broad behavior changes, run the full suite:

```sh
node tests/themes.test.mjs
node tests/config.test.mjs
node tests/model.test.mjs
node tests/layout.test.mjs
node tests/background.test.mjs
node tests/browser.test.mjs
```

The browser check requires Chrome (`google-chrome`, or set `CHROME_BIN`) and permission to start a loopback HTTP server. It uses a temporary profile and mocked Chrome APIs.

For extension UI or Chrome integration changes, reload the unpacked extension and check the affected flows in a new tab. Use the manual checklist in `README.md`, including persistence after reload and concurrent edits in multiple desktops where applicable.

Documentation-only changes need a diff review and valid manifest JSON; they do not require the application test suite. Report which checks ran and any validation that could not be completed.
