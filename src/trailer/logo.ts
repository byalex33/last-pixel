import { PAL } from '../game/constants';

/*
 * The LAST PIXEL wordmark from the game's boot screen, rebuilt at trailer scale:
 * scattered pixels rush in, the final pixel drops into the X, and red floods PIXEL.
 */

const GLYPHS: Record<string, string[]> = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};
const GW = 5;
const GH = 7;
export const LOGO_W = 9 * (GW + 1) + 1; // in blocks
export const LOGO_H = GH;

// Moments within the logo's own time, in seconds.
const FLY = 0.15;
const SPREAD = 0.8;
const FLY_DUR = 0.75;
const DROP = 1.62;
export const LOGO_IMPACT = 2;

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cell { gx: number; gy: number; pixel: boolean; last: boolean; delay: number; ang: number; rad: number }
interface Spark { vx: number; vy: number; life: number; size: number; red: boolean }

const rand = rng(7);
const CELLS: Cell[] = [];
['LAST', 'PIXEL'].forEach((word, wi) => {
  [...word].forEach((ch, li) => {
    const x0 = wi === 0 ? li * (GW + 1) : 4 * (GW + 1) + 2 + li * (GW + 1);
    GLYPHS[ch].forEach((row, cy) => {
      [...row].forEach((bit, cx) => {
        if (bit !== '1') return;
        const gx = x0 + cx;
        CELLS.push({
          gx, gy: cy, pixel: wi === 1, last: ch === 'X' && cx === 2 && cy === 3,
          delay: FLY + (gx / LOGO_W) * SPREAD + rand() * 0.2, ang: rand() * Math.PI * 2, rad: 0.6 + rand() * 0.8,
        });
      });
    });
  });
});
const LAST = CELLS.find((c) => c.last)!;
const SPARKS: Spark[] = Array.from({ length: 90 }, () => {
  const a = rand() * Math.PI * 2;
  const s = 300 + rand() * 1100;
  return { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 300, life: 0.4 + rand() * 0.9, size: 0.3 + rand() * 0.5, red: rand() < 0.6 };
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeOutExpo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));

// u is the time since the logo sequence began; pass a large u for the finished mark.
export function drawLogo(g: CanvasRenderingContext2D, u: number, cx: number, cy: number, B: number) {
  const ox = Math.round(cx - (LOGO_W * B) / 2);
  const oy = Math.round(cy - (LOGO_H * B) / 2);
  const ix = ox + LAST.gx * B + B / 2;
  const iy = oy + LAST.gy * B + B / 2;
  const since = u - LOGO_IMPACT;

  for (const c of CELLS) {
    const tx = ox + c.gx * B;
    const ty = oy + c.gy * B;
    let x = tx;
    let y = ty;
    let color: string = PAL.k7;
    if (c.last) {
      if (u < DROP) continue;
      const p = clamp01((u - DROP) / (LOGO_IMPACT - DROP));
      y = ty - (1 - p * p) * (ty + B * 2);
      color = PAL.r3;
    } else {
      const p = easeOutExpo(clamp01((u - c.delay) / FLY_DUR));
      const sx = cx + Math.cos(c.ang) * c.rad * 1100;
      const sy = cy + Math.sin(c.ang) * c.rad * 650;
      x = sx + (tx - sx) * p;
      y = sy + (ty - sy) * p;
      if (p < 1) color = p < 0.4 ? PAL.k4 : PAL.k6;
    }
    if (since >= 0 && c.pixel) {
      // Red floods outward from the impact.
      const d = Math.hypot(tx + B / 2 - ix, ty + B / 2 - iy);
      const front = since * 1500;
      if (d < front) color = d > front - B * 3 ? PAL.r3 : PAL.r2;
    }
    const s = u > LOGO_IMPACT || c.last ? B : Math.max(2, Math.round(B * 0.8));
    g.fillStyle = PAL.k0;
    g.fillRect(Math.round(x) + B * 0.18, Math.round(y) + B * 0.18, s, s);
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), s, s);
  }

  if (since >= 0 && since < 1.4) {
    for (const s of SPARKS) {
      const k = since / s.life;
      if (k >= 1) continue;
      const x = ix + s.vx * since;
      const y = iy + s.vy * since + 900 * since * since;
      const size = Math.max(2, Math.round(B * s.size * (1 - k)));
      g.fillStyle = s.red ? (k < 0.5 ? PAL.r3 : PAL.r2) : PAL.k7;
      g.fillRect(Math.round(x), Math.round(y), size, size);
    }
  }
}
