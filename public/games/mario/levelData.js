export const TILE_SIZE = 16;

const CLOUD_SPRITES = Object.freeze([
  { sx: 0, sy: 320 },
  { sx: 16, sy: 320 },
  { sx: 32, sy: 320 },
]);

const HILL_SPRITES = Object.freeze([
  { sx: 128, sy: 128 },
  { sx: 144, sy: 128 },
  { sx: 160, sy: 128 },
  { sx: 128, sy: 144 },
  { sx: 144, sy: 144 },
  { sx: 160, sy: 144 },
]);

const BUSH_SPRITES = Object.freeze([
  { sx: 176, sy: 144 },
  { sx: 192, sy: 144 },
  { sx: 208, sy: 144 },
]);

export const LEVEL_1_1 = Object.freeze({
  name: "World 1-1",
  background: "#7974FF",
  playerSpawn: Object.freeze({ x: 56, y: 192 }),
  exitTile: 204,
  flagX: 198,
  groundRanges: Object.freeze([
    Object.freeze([0, 69]),
    Object.freeze([71, 86]),
    Object.freeze([89, 153]),
    Object.freeze([155, 212]),
  ]),
  clouds: Object.freeze([
    Object.freeze([7, 3]),
    Object.freeze([19, 2]),
    Object.freeze([56, 3]),
    Object.freeze([67, 2]),
    Object.freeze([87, 2]),
    Object.freeze([103, 2]),
    Object.freeze([152, 3]),
    Object.freeze([163, 2]),
    Object.freeze([200, 3]),
  ]),
  twoClouds: Object.freeze([
    Object.freeze([36, 2]),
    Object.freeze([132, 2]),
    Object.freeze([180, 2]),
  ]),
  threeClouds: Object.freeze([
    Object.freeze([27, 3]),
    Object.freeze([75, 3]),
    Object.freeze([123, 3]),
    Object.freeze([171, 3]),
  ]),
  bigHills: Object.freeze([0, 48, 96, 144, 192]),
  smallHills: Object.freeze([16, 64, 111, 160]),
  bushes: Object.freeze([23, 71, 118, 167]),
  twoBushes: Object.freeze([41, 89, 137]),
  threeBushes: Object.freeze([11, 59, 106]),
  qBlocks: Object.freeze([
    Object.freeze([16, 9]),
    Object.freeze([21, 9]),
    Object.freeze([22, 5]),
    Object.freeze([23, 9]),
    Object.freeze([78, 9]),
    Object.freeze([94, 5]),
    Object.freeze([105, 9]),
    Object.freeze([108, 9]),
    Object.freeze([108, 5]),
    Object.freeze([111, 9]),
    Object.freeze([129, 5]),
    Object.freeze([130, 5]),
    Object.freeze([170, 9]),
  ]),
  bricks: Object.freeze([
    Object.freeze([20, 9]),
    Object.freeze([22, 9]),
    Object.freeze([24, 9]),
    Object.freeze([77, 9]),
    Object.freeze([79, 9]),
    Object.freeze([80, 5]),
    Object.freeze([81, 5]),
    Object.freeze([82, 5]),
    Object.freeze([83, 5]),
    Object.freeze([84, 5]),
    Object.freeze([85, 5]),
    Object.freeze([86, 5]),
    Object.freeze([87, 5]),
    Object.freeze([91, 5]),
    Object.freeze([92, 5]),
    Object.freeze([93, 5]),
    Object.freeze([94, 9]),
    Object.freeze([100, 9]),
    Object.freeze([101, 9]),
    Object.freeze([117, 9]),
    Object.freeze([120, 5]),
    Object.freeze([121, 5]),
    Object.freeze([122, 5]),
    Object.freeze([123, 5]),
    Object.freeze([128, 5]),
    Object.freeze([129, 9]),
    Object.freeze([130, 9]),
    Object.freeze([131, 5]),
    Object.freeze([168, 9]),
    Object.freeze([169, 9]),
    Object.freeze([171, 9]),
  ]),
  walls: Object.freeze([
    Object.freeze({ x: 134, y: 13, height: 1 }),
    Object.freeze({ x: 135, y: 13, height: 2 }),
    Object.freeze({ x: 136, y: 13, height: 3 }),
    Object.freeze({ x: 137, y: 13, height: 4 }),
    Object.freeze({ x: 140, y: 13, height: 4 }),
    Object.freeze({ x: 141, y: 13, height: 3 }),
    Object.freeze({ x: 142, y: 13, height: 2 }),
    Object.freeze({ x: 143, y: 13, height: 1 }),
    Object.freeze({ x: 148, y: 13, height: 1 }),
    Object.freeze({ x: 149, y: 13, height: 2 }),
    Object.freeze({ x: 150, y: 13, height: 3 }),
    Object.freeze({ x: 151, y: 13, height: 4 }),
    Object.freeze({ x: 152, y: 13, height: 4 }),
    Object.freeze({ x: 155, y: 13, height: 4 }),
    Object.freeze({ x: 156, y: 13, height: 3 }),
    Object.freeze({ x: 157, y: 13, height: 2 }),
    Object.freeze({ x: 158, y: 13, height: 1 }),
    Object.freeze({ x: 181, y: 13, height: 1 }),
    Object.freeze({ x: 182, y: 13, height: 2 }),
    Object.freeze({ x: 183, y: 13, height: 3 }),
    Object.freeze({ x: 184, y: 13, height: 4 }),
    Object.freeze({ x: 185, y: 13, height: 5 }),
    Object.freeze({ x: 186, y: 13, height: 6 }),
    Object.freeze({ x: 187, y: 13, height: 7 }),
    Object.freeze({ x: 188, y: 13, height: 8 }),
    Object.freeze({ x: 189, y: 13, height: 8 }),
  ]),
  pipes: Object.freeze([
    Object.freeze({ x: 28, topY: 11, height: 2 }),
    Object.freeze({ x: 38, topY: 10, height: 3 }),
    Object.freeze({ x: 46, topY: 9, height: 4 }),
    Object.freeze({ x: 57, topY: 9, height: 4 }),
    Object.freeze({ x: 163, topY: 11, height: 2 }),
    Object.freeze({ x: 179, topY: 11, height: 2 }),
  ]),
  goombas: Object.freeze([
    Object.freeze([22, 12]),
    Object.freeze([40, 12]),
    Object.freeze([50, 12]),
    Object.freeze([51, 12]),
    Object.freeze([82, 4]),
    Object.freeze([84, 4]),
    Object.freeze([100, 12]),
    Object.freeze([102, 12]),
    Object.freeze([114, 12]),
    Object.freeze([115, 12]),
    Object.freeze([122, 12]),
    Object.freeze([123, 12]),
    Object.freeze([125, 12]),
    Object.freeze([126, 12]),
    Object.freeze([170, 12]),
    Object.freeze([172, 12]),
  ]),
  koopas: Object.freeze([Object.freeze([35, 11])]),
});

function toPx(value) {
  return value * TILE_SIZE;
}

function pushTile(list, {
  layer,
  sheet,
  sx,
  sy,
  sw = TILE_SIZE,
  sh = TILE_SIZE,
  x,
  y,
  dw = sw,
  dh = sh,
}) {
  list.push({ layer, sheet, sx, sy, sw, sh, x, y, dw, dh });
}

function pushSolid(solids, xTile, yTile, wTiles = 1, hTiles = 1, type = "solid") {
  solids.push({
    x: toPx(xTile),
    y: toPx(yTile),
    w: toPx(wTiles),
    h: toPx(hTiles),
    type,
  });
}

function pushCloud(sceneryTiles, x, y) {
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: 0,
    sy: 320,
    sw: 48,
    sh: 32,
    x: toPx(x),
    y: toPx(y),
    dw: 48,
    dh: 32,
  });
}

function pushTwoCloud(sceneryTiles, x, y) {
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[0].sx,
    sy: CLOUD_SPRITES[0].sy,
    x: toPx(x),
    y: toPx(y),
  });
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[1].sx,
    sy: CLOUD_SPRITES[1].sy,
    x: toPx(x + 1),
    y: toPx(y),
  });
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[1].sx,
    sy: CLOUD_SPRITES[1].sy,
    x: toPx(x + 2),
    y: toPx(y),
  });
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[2].sx,
    sy: CLOUD_SPRITES[2].sy,
    x: toPx(x + 3),
    y: toPx(y),
  });
}

function pushThreeCloud(sceneryTiles, x, y) {
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[0].sx,
    sy: CLOUD_SPRITES[0].sy,
    x: toPx(x),
    y: toPx(y),
  });
  for (let i = 1; i <= 3; i += 1) {
    pushTile(sceneryTiles, {
      layer: "scenery",
      sheet: "tiles",
      sx: CLOUD_SPRITES[1].sx,
      sy: CLOUD_SPRITES[1].sy,
      x: toPx(x + i),
      y: toPx(y),
    });
  }
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: CLOUD_SPRITES[2].sx,
    sy: CLOUD_SPRITES[2].sy,
    x: toPx(x + 4),
    y: toPx(y),
  });
}

function pushBigHill(sceneryTiles, x, y) {
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[0].sx, sy: HILL_SPRITES[0].sy, x: toPx(x), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[3].sx, sy: HILL_SPRITES[3].sy, x: toPx(x + 1), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[0].sx, sy: HILL_SPRITES[0].sy, x: toPx(x + 1), y: toPx(y - 1) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[4].sx, sy: HILL_SPRITES[4].sy, x: toPx(x + 2), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[3].sx, sy: HILL_SPRITES[3].sy, x: toPx(x + 2), y: toPx(y - 1) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[1].sx, sy: HILL_SPRITES[1].sy, x: toPx(x + 2), y: toPx(y - 2) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[5].sx, sy: HILL_SPRITES[5].sy, x: toPx(x + 3), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[2].sx, sy: HILL_SPRITES[2].sy, x: toPx(x + 3), y: toPx(y - 1) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[2].sx, sy: HILL_SPRITES[2].sy, x: toPx(x + 4), y: toPx(y) });
}

function pushSmallHill(sceneryTiles, x, y) {
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[0].sx, sy: HILL_SPRITES[0].sy, x: toPx(x), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[3].sx, sy: HILL_SPRITES[3].sy, x: toPx(x + 1), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[1].sx, sy: HILL_SPRITES[1].sy, x: toPx(x + 1), y: toPx(y - 1) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: HILL_SPRITES[2].sx, sy: HILL_SPRITES[2].sy, x: toPx(x + 2), y: toPx(y) });
}

function pushBush(sceneryTiles, x, y) {
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: 176,
    sy: 144,
    sw: 48,
    sh: 16,
    x: toPx(x),
    y: toPx(y),
    dw: 48,
    dh: 16,
  });
}

function pushTwoBush(sceneryTiles, x, y) {
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[0].sx, sy: BUSH_SPRITES[0].sy, x: toPx(x), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[1].sx, sy: BUSH_SPRITES[1].sy, x: toPx(x + 1), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[1].sx, sy: BUSH_SPRITES[1].sy, x: toPx(x + 2), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[2].sx, sy: BUSH_SPRITES[2].sy, x: toPx(x + 3), y: toPx(y) });
}

function pushThreeBush(sceneryTiles, x, y) {
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[0].sx, sy: BUSH_SPRITES[0].sy, x: toPx(x), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[1].sx, sy: BUSH_SPRITES[1].sy, x: toPx(x + 1), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[1].sx, sy: BUSH_SPRITES[1].sy, x: toPx(x + 2), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[1].sx, sy: BUSH_SPRITES[1].sy, x: toPx(x + 3), y: toPx(y) });
  pushTile(sceneryTiles, { layer: "scenery", sheet: "tiles", sx: BUSH_SPRITES[2].sx, sy: BUSH_SPRITES[2].sy, x: toPx(x + 4), y: toPx(y) });
}

function pushVerticalPipe(pipeTiles, solids, x, topY, height) {
  for (let i = 0; i < height; i += 1) {
    const y = topY + i;
    const top = i === 0;
    pushTile(pipeTiles, {
      layer: "pipe",
      sheet: "tiles",
      sx: top ? 0 : 0,
      sy: top ? 128 : 144,
      x: toPx(x),
      y: toPx(y),
    });
    pushTile(pipeTiles, {
      layer: "pipe",
      sheet: "tiles",
      sx: top ? 16 : 16,
      sy: top ? 128 : 144,
      x: toPx(x + 1),
      y: toPx(y),
    });
    pushSolid(solids, x, y, 1, 1, "pipe");
    pushSolid(solids, x + 1, y, 1, 1, "pipe");
  }
}

export function buildOneOneTrack() {
  const solids = [];
  const sceneryTiles = [];
  const terrainTiles = [];
  const qBlockTiles = [];
  const pipeTiles = [];
  const flagTiles = [];

  for (let r = 0; r < LEVEL_1_1.groundRanges.length; r += 1) {
    const [start, end] = LEVEL_1_1.groundRanges[r];
    for (let x = start; x < end; x += 1) {
      pushTile(terrainTiles, { layer: "terrain", sheet: "tiles", sx: 0, sy: 0, x: toPx(x), y: toPx(13) });
      pushTile(terrainTiles, { layer: "terrain", sheet: "tiles", sx: 0, sy: 0, x: toPx(x), y: toPx(14) });
      pushSolid(solids, x, 13, 1, 1, "ground");
      pushSolid(solids, x, 14, 1, 1, "ground");
    }
  }

  LEVEL_1_1.clouds.forEach(([x, y]) => pushCloud(sceneryTiles, x, y));
  LEVEL_1_1.twoClouds.forEach(([x, y]) => pushTwoCloud(sceneryTiles, x, y));
  LEVEL_1_1.threeClouds.forEach(([x, y]) => pushThreeCloud(sceneryTiles, x, y));

  LEVEL_1_1.bigHills.forEach((x) => pushBigHill(sceneryTiles, x, 12));
  LEVEL_1_1.smallHills.forEach((x) => pushSmallHill(sceneryTiles, x, 12));

  LEVEL_1_1.bushes.forEach((x) => pushBush(sceneryTiles, x, 12));
  LEVEL_1_1.twoBushes.forEach((x) => pushTwoBush(sceneryTiles, x, 12));
  LEVEL_1_1.threeBushes.forEach((x) => pushThreeBush(sceneryTiles, x, 12));

  LEVEL_1_1.qBlocks.forEach(([x, y]) => {
    qBlockTiles.push({ x: toPx(x), y: toPx(y) });
    pushSolid(solids, x, y, 1, 1, "qblock");
  });

  LEVEL_1_1.bricks.forEach(([x, y]) => {
    pushTile(terrainTiles, {
      layer: "terrain",
      sheet: "tiles",
      sx: 16,
      sy: 0,
      x: toPx(x),
      y: toPx(y),
    });
    pushSolid(solids, x, y, 1, 1, "brick");
  });

  LEVEL_1_1.walls.forEach(({ x, y, height }) => {
    for (let row = y - height; row < y; row += 1) {
      pushTile(terrainTiles, {
        layer: "terrain",
        sheet: "tiles",
        sx: 0,
        sy: 16,
        x: toPx(x),
        y: toPx(row),
      });
      pushSolid(solids, x, row, 1, 1, "wall");
    }
  });

  LEVEL_1_1.pipes.forEach(({ x, topY, height }) => {
    pushVerticalPipe(pipeTiles, solids, x, topY, height);
  });

  // Flagpole base block.
  pushTile(terrainTiles, {
    layer: "terrain",
    sheet: "tiles",
    sx: 0,
    sy: 16,
    x: toPx(LEVEL_1_1.flagX),
    y: toPx(12),
  });
  pushSolid(solids, LEVEL_1_1.flagX, 12, 1, 1, "wall");

  for (let y = 3; y < 12; y += 1) {
    pushTile(sceneryTiles, {
      layer: "scenery",
      sheet: "tiles",
      sx: 256,
      sy: 144,
      x: toPx(LEVEL_1_1.flagX),
      y: toPx(y),
    });
  }
  pushTile(sceneryTiles, {
    layer: "scenery",
    sheet: "tiles",
    sx: 256,
    sy: 128,
    x: toPx(LEVEL_1_1.flagX),
    y: toPx(2),
  });

  // Initial flag position from original implementation.
  pushTile(flagTiles, {
    layer: "flag",
    sheet: "items",
    sx: 128,
    sy: 32,
    sw: 16,
    sh: 16,
    x: toPx(LEVEL_1_1.flagX) - 8,
    y: 49,
    dw: 16,
    dh: 16,
  });

  const enemySpawns = [];
  LEVEL_1_1.goombas.forEach(([x, y]) => {
    enemySpawns.push({ type: "goomba", x: toPx(x), y: toPx(y) });
  });
  LEVEL_1_1.koopas.forEach(([x, y]) => {
    enemySpawns.push({ type: "koopa", x: toPx(x), y: toPx(y) });
  });

  enemySpawns.sort((a, b) => a.x - b.x);

  const worldWidthTiles = Math.max(
    ...LEVEL_1_1.groundRanges.map(([, end]) => end),
    LEVEL_1_1.exitTile + 2,
    LEVEL_1_1.flagX + 2,
  );

  return {
    tileSize: TILE_SIZE,
    background: LEVEL_1_1.background,
    worldWidth: toPx(worldWidthTiles),
    groundY: toPx(13),
    finishX: toPx(LEVEL_1_1.flagX) - 8,
    playerSpawn: { ...LEVEL_1_1.playerSpawn },
    solids,
    enemySpawns,
    render: {
      sceneryTiles,
      terrainTiles,
      qBlockTiles,
      pipeTiles,
      flagTiles,
    },
  };
}
