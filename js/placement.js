export function findFirstEmptyTilePosition(size, tiles, gridWidth) {
    const lastPossibleX = gridWidth - size.w;
    const maxRowsToSearch = Math.max(100, getGridRow(tiles) + 100);

    for (let y = 0; y < maxRowsToSearch; y++) {
        for (let x = 0; x <= lastPossibleX; x++) {
            if (isAreaEmpty(x, y, size, tiles)) {
                return { x, y, w: size.w, h: size.h };
            }
        }
    }

    return { x: 0, y: getGridRow(tiles), w: size.w, h: size.h };
}

export function getGridRow(tiles) {
    return tiles.reduce((row, tile) => {
        const y = Number(tile.y) || 0;
        const h = Number(tile.h) || 1;
        return Math.max(row, y + h);
    }, 0);
}

export function isAreaEmpty(x, y, size, tiles) {
    return !tiles.some((tile) => areasIntersect(
        { x, y, w: size.w, h: size.h },
        {
            x: Number(tile.x) || 0,
            y: Number(tile.y) || 0,
            w: Number(tile.w) || 1,
            h: Number(tile.h) || 1
        }
    ));
}

export function areasIntersect(a, b) {
    return a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
}
