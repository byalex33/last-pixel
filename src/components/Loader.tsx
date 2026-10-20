import { useEffect, useRef } from 'react';
import { sfx } from '../game/audio';
import { PAL } from '../game/constants';

/*
 * Boot sequence: scattered pixels fly in and assemble the logo, one pixel is missing,
 * the last pixel falls into place, and red spreads from the impact through PIXEL.
 * Then the screen dissolves outward from that pixel to reveal the game.
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
const WORDS = ['LAST', 'PIXEL'];
const GW = 5;
const GH = 7;
const SEGMENTS = 20;

// Timeline, in ms.
const FLY_START = 250;
const FLY_SPREAD = 750;
const FLY_DUR = 700;
const DROP_START = 1900;
const DROP_DUR = 420;
const IMPACT = DROP_START + DROP_DUR;
const GLINT_START = 2850;
const GLINT_DUR = 520;
const MIN_TIME = 3500;
const EXIT_DUR = 950;

interface Cell {
  word: number; // 0 LAST, 1 PIXEL
  letter: number; // index within its word
  cx: number; // column within the glyph
  cy: number;
  delay: number;
  ang: number;
  rad: number;
  last: boolean;
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Dust { x: number; y: number; v: number; c: string }

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  WORDS.forEach((w, wi) => {
    [...w].forEach((ch, li) => {
      GLYPHS[ch].forEach((row, cy) => {
        [...row].forEach((bit, cx) => {
          if (bit !== '1') return;
          cells.push({
            word: wi, letter: li, cx, cy, delay: 0, ang: Math.random() * Math.PI * 2,
            rad: 0.55 + Math.random() * 0.7, last: ch === 'X' && cx === 2 && cy === 3,
          });
        });
      });
    });
  });
  return cells;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeOutExpo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Props {
  subtitle: string;
  onReveal: () => void; // the dissolve begins and the game should come alive
  onDone: () => void;
}

export function Loader({ subtitle, onReveal, onDone }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };

  useEffect(() => {
    const root = rootRef.current!;
    const canvas = canvasRef.current!;
    const g = canvas.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cells = buildCells();
    const segs = [...barRef.current!.children] as HTMLElement[];

    let fontsReady = false;
    document.fonts.ready.then(() => (fontsReady = true), () => (fontsReady = true));

    // Layout, recomputed on resize. Everything is in device pixels.
    let vw = 0;
    let vh = 0;
    let B = 8; // block size
    let stacked = false;
    let ox = 0; // logo origin
    let oy = 0;
    let lw = 0; // logo size in blocks
    let lh = 0;
    let tile = 32;
    let dust: Dust[] = [];

    const letterX = (word: number, letter: number) => {
      if (!stacked) return word === 0 ? letter * (GW + 1) : 4 * (GW + 1) + 2 + letter * (GW + 1);
      const wordW = WORDS[word].length * (GW + 1) - 1;
      return Math.floor((lw - wordW) / 2) + letter * (GW + 1);
    };
    const letterY = (word: number) => (stacked && word === 1 ? GH + 3 : 0);
    const gridX = (c: Cell) => letterX(c.word, c.letter) + c.cx;
    const gridY = (c: Cell) => letterY(c.word) + c.cy;

    const layout = () => {
      // Measure the overlay itself: on phones window.innerWidth can report a wider layout viewport.
      const cw = root.clientWidth;
      const ch = root.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = Math.round(cw * dpr);
      vh = Math.round(ch * dpr);
      canvas.width = vw;
      canvas.height = vh;
      stacked = cw < 640 || cw / ch < 0.9;
      lw = stacked ? 5 * (GW + 1) - 1 : 9 * (GW + 1) + 1;
      lh = stacked ? GH * 2 + 3 : GH;
      B = Math.max(3, Math.floor(Math.min((vw * 0.82) / lw, (vh * 0.42) / lh)));
      ox = Math.round((vw - lw * B) / 2);
      oy = Math.round(vh * 0.44 - (lh * B) / 2);
      tile = B * 2;
      cells.forEach((c) => (c.delay = FLY_START + (gridX(c) / lw) * FLY_SPREAD + Math.random() * 220));
      dust = Array.from({ length: Math.round((vw * vh) / (B * B * 260)) }, () => ({
        x: Math.random() * vw, y: Math.random() * vh, v: 0.15 + Math.random() * 0.5,
        c: Math.random() < 0.12 ? PAL.r0 : Math.random() < 0.5 ? PAL.k2 : PAL.k1,
      }));
      const foot = footRef.current!;
      foot.style.top = `${(oy + lh * B) / dpr + Math.max(28, B / dpr * 3)}px`;
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(root);

    const lastCell = cells.find((c) => c.last)!;
    const sparks: Spark[] = [];
    const t0 = performance.now();
    let prev = t0;
    let exitAt = reduced ? 700 : Infinity;
    let skipped = reduced;
    let impacted = false;
    let revealed = false;
    let raf = 0;
    let shownSegs = -1;
    let tileOrder: Float32Array | null = null;

    const burst = (x: number, y: number) => {
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.4 + Math.random()) * B * 0.05;
        sparks.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - B * 0.02, life: 0, max: 500 + Math.random() * 600,
          color: [PAL.r2, PAL.r3, PAL.k7, PAL.r1][i % 4], size: Math.max(2, Math.round(B * (Math.random() < 0.3 ? 0.5 : 0.34))),
        });
      }
    };

    const skip = () => {
      // A click or key press here is a user gesture, so audio can start (the story typing needs it).
      sfx.unlock();
      if (exitAt !== Infinity) return;
      skipped = true;
      exitAt = performance.now() - t0;
    };
    root.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = now - t0;
      const dt = Math.min(50, now - prev);
      prev = now;
      // The logo's own clock. Skipping jumps it to the finished state.
      const lt = skipped ? 1e9 : t;

      if (exitAt === Infinity && t >= MIN_TIME && fontsReady) exitAt = t;
      const ex = clamp01((t - exitAt) / EXIT_DUR);
      if (ex > 0 && !revealed) {
        revealed = true;
        root.classList.add('is-exiting');
        cb.current.onReveal();
      }
      if (ex >= 1) {
        cancelAnimationFrame(raf);
        cb.current.onDone();
        return;
      }

      // Shake on impact.
      const sk = !skipped && lt > IMPACT && lt < IMPACT + 320 ? (1 - (lt - IMPACT) / 320) * B * 0.45 : 0;
      const shx = Math.round((Math.random() - 0.5) * 2 * sk);
      const shy = Math.round((Math.random() - 0.5) * 2 * sk);

      g.clearRect(0, 0, vw, vh);

      // Background tiles dissolve outward from the last pixel.
      const ipx = ox + gridX(lastCell) * B + B / 2;
      const ipy = oy + gridY(lastCell) * B + B / 2;
      const cols = Math.ceil(vw / tile);
      const rows = Math.ceil(vh / tile);
      if (!tileOrder || tileOrder.length !== cols * rows) {
        const far = Math.hypot(Math.max(ipx, vw - ipx), Math.max(ipy, vh - ipy));
        tileOrder = new Float32Array(cols * rows);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x * tile + tile / 2 - ipx, y * tile + tile / 2 - ipy) / far;
          tileOrder[y * cols + x] = Math.min(0.97, d * 0.75 + Math.random() * 0.2);
        }
      }
      if (ex <= 0) {
        g.fillStyle = PAL.k0;
        g.fillRect(0, 0, vw, vh);
      } else {
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const k = tileOrder[y * cols + x];
          if (ex > k + 0.06) continue;
          g.fillStyle = ex > k ? PAL.r1 : PAL.k0;
          g.fillRect(x * tile, y * tile, tile, tile);
        }
      }

      // Drifting dust.
      const dz = Math.max(1, Math.round(B / 3));
      for (const d of dust) {
        d.y -= d.v * dt * 0.06 * (B / 8);
        if (d.y < -dz) d.y = vh + dz;
        if (ex > 0) continue;
        g.fillStyle = d.c;
        g.fillRect(Math.round(d.x), Math.round(d.y), dz, dz);
      }

      g.save();
      g.translate(shx, shy);

      // Impact flash, shockwave and sparks.
      if (!impacted && lt >= IMPACT) {
        impacted = true;
        if (!skipped) burst(ipx, ipy);
      }
      if (!skipped && lt >= IMPACT && lt < IMPACT + 700) {
        const k = (lt - IMPACT) / 700;
        if (k < 0.35) {
          g.globalAlpha = (1 - k / 0.35) * 0.18;
          g.fillStyle = PAL.r3;
          g.fillRect(-shx, -shy, vw, vh);
          g.globalAlpha = 1;
        }
        const r = easeOutExpo(k) * B * 16;
        const bs = Math.max(2, Math.round(B * 0.4 * (1 - k) + 1));
        const n = Math.max(12, Math.round((r * Math.PI * 2) / (bs * 1.6)));
        g.fillStyle = k < 0.3 ? PAL.k7 : k < 0.6 ? PAL.r3 : PAL.r1;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          g.fillRect(Math.round((ipx + Math.cos(a) * r) / bs) * bs, Math.round((ipy + Math.sin(a) * r) / bs) * bs, bs, bs);
        }
      }

      // Logo blocks.
      const sh = Math.max(2, Math.round(B * 0.3));
      const glint = (lt - GLINT_START) / GLINT_DUR;
      const exitFly = ex > 0 ? easeOutExpo(ex) : 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const c of cells) {
          const gx = gridX(c);
          const gy = gridY(c);
          const tx = ox + gx * B;
          const ty = oy + gy * B;
          let x = tx;
          let y = ty;
          let color: string;
          let shadow: string = PAL.k2;
          let landed = true;

          if (c.last) {
            if (lt < DROP_START) continue;
            const p = clamp01((lt - DROP_START) / DROP_DUR);
            y = lerp(-B * 2, ty, p * p);
            landed = p >= 1;
            if (!landed && pass === 1) {
              for (let i = 1; i <= 4; i++) {
                g.fillStyle = [PAL.r3, PAL.r2, PAL.r1, PAL.r0][i - 1];
                g.fillRect(x, Math.round(y - i * B * 0.9), B, B);
              }
            }
            color = landed ? (lt < IMPACT + 140 ? PAL.k7 : PAL.r2) : PAL.k7;
            shadow = PAL.r0;
          } else {
            const p = clamp01((lt - c.delay) / FLY_DUR);
            if (p <= 0) continue;
            const e = easeOutExpo(p);
            const far = Math.hypot(vw, vh) * 0.5 * c.rad;
            const sx = ox + (lw * B) / 2 + Math.cos(c.ang) * far;
            const sy = oy + (lh * B) / 2 + Math.sin(c.ang) * far;
            x = lerp(sx, tx, e);
            y = lerp(sy, ty, e);
            landed = p >= 1;
            const since = lt - (c.delay + FLY_DUR);
            color = !landed ? (p < 0.5 ? PAL.k3 : PAL.k4) : since < 110 ? PAL.k7 : PAL.k5;

            if (lt >= IMPACT) {
              const dist = Math.hypot(gx - gridX(lastCell), gy - gridY(lastCell));
              if (c.word === 1) {
                const at = IMPACT + 60 + dist * 34;
                if (lt >= at) {
                  color = lt < at + 120 ? PAL.r3 : PAL.r2;
                  shadow = PAL.r0;
                }
              } else {
                const at = IMPACT + 120 + dist * 22;
                if (lt >= at) color = lt < at + 120 ? PAL.k7 : PAL.k6;
              }
            }
            if (glint > 0 && glint < 1) {
              const band = glint * (lw + lh + 8) - 4;
              if (Math.abs(gx + gy - band) < 1.6) color = c.word === 1 ? PAL.r3 : PAL.k7;
            }
          }

          // Exit: blocks blow outward from the impact and fall away.
          if (exitFly > 0) {
            const dx = tx - ipx;
            const dy = ty - ipy;
            const len = Math.hypot(dx, dy) || 1;
            const push = exitFly * B * (6 + ((gx * 7 + gy * 13) % 9));
            x += (dx / len) * push;
            y += (dy / len) * push + ex * ex * B * 14;
            g.globalAlpha = 1 - ex;
          }

          x = Math.round(x);
          y = Math.round(y);
          if (pass === 0) {
            if (!landed || exitFly > 0) continue;
            g.fillStyle = shadow;
            g.fillRect(x + sh, y + sh, B, B);
          } else {
            if (!landed && !c.last) {
              // A faint afterimage behind each flying block.
              g.fillStyle = PAL.k2;
              g.fillRect(Math.round(lerp(x, tx, -0.12)), Math.round(lerp(y, ty, -0.12)), B, B);
            }
            g.fillStyle = color;
            g.fillRect(x, y, B, B);
          }
        }
      }
      g.globalAlpha = 1;

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += B * 0.00012 * dt;
        s.vx *= 0.985;
        g.globalAlpha = 1 - s.life / s.max;
        g.fillStyle = s.color;
        g.fillRect(Math.round(s.x / s.size) * s.size, Math.round(s.y / s.size) * s.size, s.size, s.size);
      }
      g.globalAlpha = 1;
      g.restore();

      // Progress bar: paced by the timeline, held short of full until fonts are in.
      const pct = ex > 0 ? 1 : Math.min(fontsReady ? 1 : 0.95, (skipped ? MIN_TIME : t) / MIN_TIME);
      const on = Math.round(pct * SEGMENTS);
      if (on !== shownSegs) {
        shownSegs = on;
        segs.forEach((s, i) => s.classList.toggle('on', i < on));
        pctRef.current!.textContent = `${Math.round(pct * 100)}%`;
      }
      subRef.current!.classList.toggle('is-shown', lt >= IMPACT + 300);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', skip);
      root.removeEventListener('pointerdown', skip);
    };
  }, []);

  return (
    <div className="loader" ref={rootRef} role="status" aria-label="Loading Last Pixel">
      <canvas ref={canvasRef} className="loader-canvas" aria-hidden />
      <div className="loader-crt" aria-hidden />
      <div className="loader-foot" ref={footRef}>
        <p className="loader-sub" ref={subRef}>{subtitle}</p>
        <div className="loader-bar" ref={barRef} aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => <span key={i} />)}
        </div>
        <div className="loader-meta">
          <span>Loading</span>
          <span ref={pctRef}>0%</span>
        </div>
        <p className="loader-skip">Click or press any key to skip</p>
      </div>
    </div>
  );
}
