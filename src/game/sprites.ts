import { PAL, TILE } from './constants';
import type { EnemyType, TowerType } from './data';

export type Sprite = HTMLCanvasElement;

const CMAP: Record<string, string> = {
  '0': PAL.k0, '1': PAL.k1, '2': PAL.k2, '3': PAL.k3,
  '4': PAL.k4, '5': PAL.k5, '6': PAL.k6, '7': PAL.k7,
  a: PAL.r0, b: PAL.r1, c: PAL.r2, d: PAL.r3,
};

export function makeSprite(rows: string[], override?: string): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!ch || ch === '.') continue;
      g.fillStyle = override ?? CMAP[ch] ?? '#f0f';
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/* ---------------------------------------------------------------- enemies */

export interface EnemySprite {
  frames: Sprite[];
  flash: Sprite[];
  w: number;
  h: number;
}

function enemy(body: string[], legsA: string[], legsB: string[]): EnemySprite {
  const rows = [[...body, ...legsA], [...body, ...legsB]];
  const frames = rows.map((r) => makeSprite(r));
  return {
    frames,
    flash: rows.map((r) => makeSprite(r, PAL.k7)),
    w: frames[0].width,
    h: frames[0].height,
  };
}

export const ENEMY_SPRITES: Record<EnemyType, EnemySprite> = {
  crawler: enemy(
    ['..6666..', '.600006.', '60c00c06', '60000006', '60000006', '.600006.'],
    ['.6....6.', '6......6'],
    ['..6..6..', '..6..6..'],
  ),
  runner: enemy(
    ['..666..', '.60006.', '60c0c06', '6000006', '.66666.'],
    ['6.....6'],
    ['..6.6..'],
  ),
  brute: enemy(
    [
      '..66666666..',
      '.6000000006.',
      '600000000006',
      '600cc00cc006',
      '600cc00cc006',
      '600000000006',
      '600677776006',
      '600000000006',
      '600000000006',
      '.6000000006.',
      '..66666666..',
    ],
    ['.66......66.'],
    ['...66..66...'],
  ),
  armor: enemy(
    [
      '..666666..',
      '.65555556.',
      '6544444456',
      '654c44c456',
      '6544444456',
      '6533333356',
      '6544444456',
      '.65555556.',
      '..666666..',
    ],
    ['.6.6..6.6.'],
    ['..6.66.6..'],
  ),
  splitter: enemy(
    [
      '...6666...',
      '.66000066.',
      '6000000006',
      '60c0000c06',
      '6000660006',
      '6006006006',
      '6060000606',
      '6000000006',
      '.66000066.',
    ],
    ['..6....6..'],
    ['...6..6...'],
  ),
  wisp: enemy(
    ['..6666..', '.655556.', '65c55c56', '65555556', '65555556', '65555556'],
    ['656.656.', '6...6...'],
    ['.656.656', '...6...6'],
  ),
  boss: enemy(
    [
      'c..............c',
      '.c..66666666..c.',
      '..660000000066..',
      '.60000000000006.',
      '6000000000000006',
      '600cc000000cc006',
      '60cddc0000cddc06',
      '600cc000000cc006',
      '6000000000000006',
      '6000767676760006',
      '6000000000000006',
      '6000000000000006',
      '.60000000000006.',
      '..660000000066..',
    ],
    ['..66........66..', '.666........666.'],
    ['....66....66....', '...666....666...'],
  ),
  mender: enemy(
    ['..6666..', '.600006.', '60c00c06', '60077006', '67777776', '60077006', '.600006.'],
    ['.6....6.'],
    ['..6..6..'],
  ),
  // Rows are deliberately offset so it looks torn.
  glitch: enemy(
    ['.66666..', '6000006.', '.60c0c06', '6000006.', '.6000006', '6666666.'],
    ['.6...6..'],
    ['..6.6...'],
  ),
  eraser: enemy(
    [
      '.6666666666666666.',
      '677777777777777776',
      '677cc77777777cc776',
      '67cddc777777cddc76',
      '677cc77777777cc776',
      '677777777777777776',
      '6bbbbbbbbbbbbbbbb6',
      '6cccccccccccccccc6',
      '6bbbbbbbbbbbbbbbb6',
      '600000000000000006',
      '600000000000000006',
      '.6666666666666666.',
    ],
    ['.666..........666.'],
    ['...666......666...'],
  ),
};

/* ----------------------------------------------------------------- towers */

const HEADS: Record<TowerType, Sprite> = {
  blaster: makeSprite([
    '..5555..',
    '.566665.',
    '56677665',
    '567cc765',
    '567cc765',
    '56677665',
    '.566665.',
    '..5555..',
  ]),
  mortar: makeSprite([
    '.44444444.',
    '4555555554',
    '4566666654',
    '4563333654',
    '4563003654',
    '4563003654',
    '4563333654',
    '4566666654',
    '4555555554',
    '.44444444.',
  ]),
  frost: makeSprite([
    '....66....',
    '...6776...',
    '..677776..',
    '.67744776.',
    '6774774776',
    '6774774776',
    '.67744776.',
    '..677776..',
    '...6776...',
    '....66....',
  ]),
  rail: makeSprite([
    '..3333..',
    '.344443.',
    '34555543',
    '345cc543',
    '345cc543',
    '34555543',
    '.344443.',
    '..3333..',
  ]),
  tesla: makeSprite([
    '...4cc4...',
    '..4cddc4..',
    '..466664..',
    '...4664...',
    '..466664..',
    '..467764..',
    '...4664...',
    '..466664..',
    '.45555554.',
    '4444444444',
  ]),
  flamer: makeSprite([
    '..4444..',
    '.455554.',
    '45cddc54',
    '45dccd54',
    '45cddc54',
    '45dccd54',
    '.455554.',
    '..4444..',
  ]),
  mines: makeSprite([
    '4444444444',
    '4555555554',
    '4533333354',
    '453c33c354',
    '4533cc3354',
    '4533cc3354',
    '453c33c354',
    '4533333354',
    '4555555554',
    '4444444444',
  ]),
  harvester: makeSprite([
    '..5555..',
    '.566665.',
    '56677665',
    '5673c765',
    '567c3765',
    '56677665',
    '.566665.',
    '..5555..',
  ]),
  beacon: makeSprite([
    '...44...',
    '..4554..',
    '..4554..',
    '...44...',
    '...55...',
    '..5665..',
    '.566665.',
    '56666665',
  ]),
  lancer: makeSprite([
    '...44...',
    '..4664..',
    '.467764.',
    '467cc764',
    '467cc764',
    '.467764.',
    '..4664..',
    '...44...',
  ]),
  quake: makeSprite([
    '.33333333.',
    '3444444443',
    '3455555543',
    '3456666543',
    '3456776543',
    '3456776543',
    '3456666543',
    '3455555543',
    '3444444443',
    '.33333333.',
  ]),
};

export function drawBase(g: CanvasRenderingContext2D, x: number, y: number, level: number) {
  g.fillStyle = PAL.k1;
  g.fillRect(x + 1, y + 2, 14, 14);
  g.fillStyle = PAL.k3;
  g.fillRect(x + 1, y + 1, 14, 14);
  g.fillStyle = PAL.k2;
  g.fillRect(x + 2, y + 2, 12, 12);
  g.fillStyle = PAL.k4;
  g.fillRect(x + 2, y + 1, 12, 1);
  g.fillRect(x + 1, y + 2, 1, 12);
  g.fillStyle = level >= 3 ? PAL.r2 : level === 2 ? PAL.k7 : PAL.k5;
  for (const [a, b] of [[2, 2], [13, 2], [2, 13], [13, 13]]) g.fillRect(x + a, y + b, 1, 1);
}

function barrel(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ang: number,
  len: number,
  thick: number,
  color: string,
  tip: string,
) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const o = thick / 2;
  for (let i = 2; i <= len; i++) {
    g.fillStyle = i >= len - 1 ? tip : color;
    g.fillRect(Math.round(cx + c * i - o), Math.round(cy + s * i - o), thick, thick);
  }
}

export function drawTowerSprite(
  g: CanvasRenderingContext2D,
  type: TowerType,
  level: number,
  x: number,
  y: number,
  angle: number,
  recoil: number,
  time: number,
  pulse = 0,
) {
  drawBase(g, x, y, level);
  const cx = x + 8;
  const cy = y + 8;
  const kick = recoil > 0 ? 2 : 0;
  switch (type) {
    case 'blaster':
      barrel(g, cx, cy, angle, 9 - kick, 2, PAL.k6, PAL.k7);
      if (level >= 3) barrel(g, cx, cy, angle + 0.5, 6 - kick, 1, PAL.k5, PAL.k6);
      break;
    case 'mortar':
      barrel(g, cx, cy, angle, 8 - kick, 3, PAL.k4, level >= 2 ? PAL.k6 : PAL.k5);
      break;
    case 'rail': {
      const px = -Math.sin(angle);
      const py = Math.cos(angle);
      barrel(g, cx + px * 1.2, cy + py * 1.2, angle, 11 - kick, 1, PAL.k6, PAL.r2);
      barrel(g, cx - px * 1.2, cy - py * 1.2, angle, 11 - kick, 1, PAL.k6, PAL.r2);
      break;
    }
    case 'flamer':
      barrel(g, cx, cy, angle, 8, 2, PAL.k5, PAL.k3);
      break;
    case 'lancer':
      // pulse carries the Lancer's heat, 0..1
      barrel(g, cx, cy, angle, 12, 1, PAL.k6, pulse > 0.6 ? PAL.k7 : pulse > 0 ? PAL.r3 : PAL.r1);
      if (level >= 2) barrel(g, cx, cy, angle, 7, 2, PAL.k4, PAL.k5);
      break;
  }
  if (type === 'harvester') {
    // Rotating gear teeth behind the hub.
    const spin = time * 1.6;
    g.fillStyle = level >= 3 ? PAL.r1 : PAL.k4;
    for (let i = 0; i < 8; i++) {
      const a = spin + (i / 8) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * 5.5) - 1, Math.round(cy + Math.sin(a) * 5.5) - 1, 2, 2);
    }
  }
  const head = HEADS[type];
  // The Quake hammer lifts just before it lands.
  const lift = type === 'quake' && pulse > 0.25 ? 2 : 0;
  g.drawImage(head, cx - (head.width >> 1), cy - (head.height >> 1) - lift);
  if (type === 'flamer') {
    const tx = Math.round(cx + Math.cos(angle) * 8);
    const ty = Math.round(cy + Math.sin(angle) * 8);
    g.fillStyle = Math.sin(time * 23) > 0 ? PAL.r3 : PAL.r2;
    g.fillRect(tx - 1, ty - 1, 2, 2);
  }
  if (type === 'mines' && recoil > 0) {
    g.fillStyle = PAL.k7;
    g.fillRect(cx - 1, cy - 1, 2, 2);
  }
  if (type === 'harvester' && pulse > 0) {
    g.fillStyle = PAL.k7;
    g.fillRect(cx - 1, cy - 1, 2, 2);
  }
  if (type === 'beacon') {
    g.fillStyle = pulse > 0 ? PAL.k7 : Math.sin(time * 5) > 0 ? PAL.r3 : PAL.r1;
    g.fillRect(cx - 1, cy - 5, 2, 2);
    if (level >= 3) {
      g.fillStyle = PAL.r2;
      g.fillRect(cx - 4, cy + 3, 1, 1);
      g.fillRect(cx + 3, cy + 3, 1, 1);
    }
  }
  if (type === 'quake' && lift) {
    g.fillStyle = PAL.k1;
    g.fillRect(cx - 5, cy + 5, 10, 1);
  }
  if (type === 'frost') {
    g.fillStyle = pulse > 0 ? PAL.k7 : Math.sin(time * 4) > 0 ? PAL.k6 : PAL.k5;
    g.fillRect(cx - 1, cy - 1, 2, 2);
    if (pulse > 0) {
      g.fillStyle = PAL.k7;
      g.fillRect(cx - 2, cy - 5, 4, 1);
      g.fillRect(cx - 2, cy + 4, 4, 1);
    }
  }
  if (type === 'tesla') {
    g.fillStyle = Math.random() < 0.5 ? PAL.r3 : PAL.k7;
    g.fillRect(cx - 1, cy - 4, 2, 1);
  }
  // level pips along the bottom of the base
  g.fillStyle = PAL.k7;
  for (let i = 0; i < level; i++) g.fillRect(x + 6 + i * 2, y + 14, 1, 1);
}

/* ------------------------------------------------------------- primitives */

export function plotLine(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, size = 1) {
  let x0 = Math.round(ax);
  let y0 = Math.round(ay);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor(size / 2);
  for (let i = 0; i < 2000; i++) {
    g.fillRect(x0 - o, y0 - o, size, size);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function pixelCircle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, dashed = false) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.round(r);
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    if (!dashed || y % 4 < 2) {
      g.fillRect(cx + x, cy + y, 1, 1);
      g.fillRect(cx + y, cy + x, 1, 1);
      g.fillRect(cx - y, cy + x, 1, 1);
      g.fillRect(cx - x, cy + y, 1, 1);
      g.fillRect(cx - x, cy - y, 1, 1);
      g.fillRect(cx - y, cy - x, 1, 1);
      g.fillRect(cx + y, cy - x, 1, 1);
      g.fillRect(cx + x, cy - y, 1, 1);
    }
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

export function fillDisc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

/* --------------------------------------------------------------- 3x5 font */

const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
};

export const textWidth = (s: string) => s.length * 4 - 1;

export function drawText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string) {
  x = Math.round(x);
  y = Math.round(y);
  for (let pass = 0; pass < 2; pass++) {
    g.fillStyle = pass === 0 ? PAL.k0 : color;
    const o = pass === 0 ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
      const gl = GLYPHS[s[i]];
      if (!gl) continue;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (gl[r][c] === '1') g.fillRect(x + i * 4 + c + o, y + r + o, 1, 1);
      }
    }
  }
}

/* ------------------------------------------------------------------ icons */

const iconCache = new Map<string, string>();

export function towerIcon(type: TowerType, level = 1): string {
  const key = `t:${type}:${level}`;
  let url = iconCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    drawTowerSprite(c.getContext('2d')!, type, level, 0, 0, -Math.PI / 4, 0, 0);
    url = c.toDataURL();
    iconCache.set(key, url);
  }
  return url;
}

export function enemyIcon(type: EnemyType): string {
  const key = `e:${type}`;
  let url = iconCache.get(key);
  if (!url) {
    url = ENEMY_SPRITES[type].frames[0].toDataURL();
    iconCache.set(key, url);
  }
  return url;
}
