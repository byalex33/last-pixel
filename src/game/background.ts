import { COLS, H, PAL, ROWS, TILE, W } from './constants';
import { type MapDef, tileKey } from './maps';
import { fillDisc, pixelCircle } from './sprites';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildBackground(map: MapDef, path: Set<number>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(hash(map.id));
  const ri = (n: number) => Math.floor(rnd() * n);
  // Off-map neighbours count as path so the entry has no edge line.
  const isP = (x: number, y: number) => x < 0 || x >= COLS || y < 0 || y >= ROWS || path.has(tileKey(x, y));

  g.fillStyle = PAL.k0;
  g.fillRect(0, 0, W, H);

  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      if (path.has(tileKey(tx, ty))) {
        g.fillStyle = PAL.k2;
        g.fillRect(x, y, TILE, TILE);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = rnd() < 0.5 ? PAL.k3 : PAL.k1;
          g.fillRect(x + 1 + ri(14), y + 1 + ri(14), 1, 1);
        }
        g.fillStyle = PAL.k3;
        if (!isP(tx, ty - 1)) g.fillRect(x, y, TILE, 1);
        if (!isP(tx, ty + 1)) g.fillRect(x, y + 15, TILE, 1);
        if (!isP(tx - 1, ty)) g.fillRect(x, y, 1, TILE);
        if (!isP(tx + 1, ty)) g.fillRect(x + 15, y, 1, TILE);
        // inner corner nubs
        g.fillStyle = PAL.k3;
        if (isP(tx, ty - 1) && isP(tx - 1, ty) && !isP(tx - 1, ty - 1)) g.fillRect(x, y, 1, 1);
        if (isP(tx, ty - 1) && isP(tx + 1, ty) && !isP(tx + 1, ty - 1)) g.fillRect(x + 15, y, 1, 1);
        if (isP(tx, ty + 1) && isP(tx - 1, ty) && !isP(tx - 1, ty + 1)) g.fillRect(x, y + 15, 1, 1);
        if (isP(tx, ty + 1) && isP(tx + 1, ty) && !isP(tx + 1, ty + 1)) g.fillRect(x + 15, y + 15, 1, 1);
        continue;
      }

      for (let k = 0; k < 3; k++) {
        if (rnd() < 0.55) {
          g.fillStyle = rnd() < 0.75 ? PAL.k1 : PAL.k2;
          g.fillRect(x + ri(16), y + ri(16), 1, 1);
        }
      }
      const r = rnd();
      const ox = x + 3 + ri(9);
      const oy = y + 3 + ri(9);
      if (r < 0.08) {
        // rock
        g.fillStyle = PAL.k2;
        g.fillRect(ox, oy, 3, 2);
        g.fillRect(ox + 1, oy - 1, 2, 1);
        g.fillStyle = PAL.k3;
        g.fillRect(ox + 1, oy - 1, 1, 1);
      } else if (r < 0.17) {
        // tuft
        g.fillStyle = PAL.k3;
        g.fillRect(ox, oy, 1, 1);
        g.fillRect(ox + 2, oy, 1, 1);
        g.fillRect(ox + 1, oy - 1, 1, 2);
      } else if (r < 0.19) {
        // old bones
        g.fillStyle = PAL.k4;
        g.fillRect(ox, oy, 4, 1);
        g.fillRect(ox - 1, oy - 1, 1, 1);
        g.fillRect(ox - 1, oy + 1, 1, 1);
        g.fillRect(ox + 4, oy - 1, 1, 1);
        g.fillRect(ox + 4, oy + 1, 1, 1);
      } else if (r < 0.21) {
        // dried blood
        g.fillStyle = PAL.r0;
        g.fillRect(ox, oy, 2, 1);
        g.fillRect(ox + 1, oy + 1, 2, 1);
        g.fillRect(ox + 3, oy - 1, 1, 1);
      } else if (r < 0.25) {
        // crack
        g.fillStyle = PAL.k1;
        for (let i = 0; i < 5; i++) g.fillRect(ox + i, oy + (i % 2), 1, 1);
      }
    }
  }

  // Portal platform
  const [ptx, pty] = map.path[map.path.length - 1];
  const px = ptx * TILE + 8;
  const py = pty * TILE + 8;
  g.fillStyle = PAL.k3;
  fillDisc(g, px, py, 8);
  g.fillStyle = PAL.k1;
  fillDisc(g, px, py, 7);
  g.fillStyle = PAL.k4;
  pixelCircle(g, px, py, 8, true);

  return c;
}
