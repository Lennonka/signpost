#!/bin/sh
set -eu

# Resolve paths relative to the script, independent of the caller's directory.
script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
project_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$project_root"

set -- manifest.json \
    signpost.html signpost.js styles.css \
    background.js background-image-startup.js \
    action-menu.html action-menu.js action-menu.css \
    js gridstack icons

if ! command -v zip >/dev/null 2>&1; then
    printf 'Packaging requires the zip utility.\n' >&2
    exit 1
fi

# Check sources before clearing an earlier package.
for entry do
    if [ ! -f "$entry" ] && [ ! -d "$entry" ]; then
        printf 'Missing package source: %s\n' "$entry" >&2
        exit 1
    fi
done

rm -rf dist
mkdir dist
zip -q -r dist/signpost.zip "$@"
printf 'Packaged Signpost in %s/dist/signpost.zip\n' "$project_root"
