import { COLS, H, PAL, ROWS, W } from '../game/constants';
import { ENEMIES, TOWERS, TOWER_ORDER, type EnemyType, type TowerType } from '../game/data';
import { MAPS, tileKey } from '../game/maps';
import { ENEMY_SPRITES, drawTowerSprite } from '../game/sprites';
import { Sim } from './sim';
import { drawLogo, rng } from './logo';
import { BAR, BEAT, END, T, TYPED, charTimes, inGroove } from './timeline';

/*
 * Draws trailer time t onto a 1920x1080 canvas: live game shots, captions and post effects.
 * Shots run the real engine; each one only advances while it is on screen.
 */

export const VW = 1920;
export const VH = 1080;
const FONT = 'Silkscreen, ui-monospace, monospace';
const BARS = 96; // letterbox height
const S16 = BEAT / 4;

interface Cam { x: number; y: number; z: number }
interface Shot { from: number; to: number; sim: Sim; cam: (u: number, sim: Sim) => Cam; bars?: boolean }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const ease = (k: number) => 1 - (1 - k) ** 3;
const pan = (a: Cam, b: Cam) => (u: number, len = 2): Cam => {
  const k = ease(clamp01(u / len));
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
};

const ALL_FOES: EnemyType[] = ['crawler', 'runner', 'brute', 'armor', 'splitter', 'wisp', 'mender', 'glitch'];
const ROSTER = ALL_FOES;
const FIGHTERS: TowerType[] = ['blaster', 'mortar', 'tesla', 'rail', 'frost', 'flamer', 'lancer', 'quake', 'mines', 'beacon'];

// right: the caption sits on the right so it does not cover the action.
const MONTAGE: { type: TowerType; line: string; right?: boolean }[] = [
  { type: 'blaster', line: 'RAPID FIRE. NO MERCY.', right: true },
  { type: 'mortar', line: 'LOB SHELLS. BIG BOOMS.', right: true },
  { type: 'frost', line: 'FREEZE THE HORDE IN ITS TRACKS.', right: true },
  { type: 'rail', line: 'ONE BEAM. EVERY FOE IN THE LINE.' },
  { type: 'tesla', line: 'LIGHTNING THAT JUMPS FOE TO FOE.', right: true },
  { type: 'flamer', line: 'BURN STRAIGHT THROUGH ARMOR.', right: true },
  { type: 'lancer', line: 'THE LONGER IT HOLDS, THE HOTTER IT GETS.' },
  { type: 'quake', line: 'KNOCK THEM BACK. STUN THEM COLD.' },
];

const FINALE_WORDS = ['30 WAVES', '5 ROUNDS', '11 TOWERS', '10 ENEMIES', 'ENDLESS MODE', 'HOLD THE LINE.'];

const SKULL = ['.11111.', '1111111', '1001001', '1111111', '.11011.', '.10101.'];

/* ------------------------------------------------------------------ shots */

function autoDefend(sim: Sim, n: number, types: TowerType[], seed: number, level = 3) {
  const r = rng(seed);
  const near: { x: number; y: number }[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!sim.game.canBuild(x, y)) continue;
      let touches = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && sim.game.pathSet.has(tileKey(nx, ny))) touches = true;
        }
      }
      if (touches) near.push({ x, y });
    }
  }
  for (let i = near.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [near[i], near[j]] = [near[j], near[i]];
  }
  const picked: { x: number; y: number }[] = [];
  for (const gap of [2, 1]) {
    for (const c of near) {
      if (picked.length >= n) break;
      if (picked.includes(c)) continue;
      if (picked.every((p) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) >= gap)) picked.push(c);
    }
  }
  picked.forEach((p, i) => sim.build(types[i % types.length], p.x, p.y, level));
  return sim;
}

function gate() {
  return new Sim(0);
}

function montageSims(): { sim: Sim; cam: (u: number) => Cam }[] {
  const out: { sim: Sim; cam: (u: number) => Cam }[] = [];
  const add = (sim: Sim, a: Cam, b: Cam) => out.push({ sim: sim.warm(2.6), cam: (u) => pan(a, b)(u) });

  let s = gate().build('blaster', 2, 4).build('blaster', 4, 5).build('blaster', 2, 1);
  add(s.stream(['crawler', 'runner', 'crawler'], 0.24, 3.5), { x: 90, y: 70, z: 10 }, { x: 100, y: 78, z: 11.5 });

  s = gate().build('mortar', 5, 6).build('mortar', 7, 10);
  add(s.stream(['brute', 'crawler', 'crawler', 'armor'], 0.4, 2, s.distNearTile(3, 4)), { x: 92, y: 118, z: 9 }, { x: 98, y: 124, z: 10.5 });

  s = gate().build('frost', 10, 4).build('blaster', 11, 2).build('blaster', 9, 2);
  add(s.stream(['runner', 'crawler'], 0.25, 1.6, s.distNearTile(8, 6)), { x: 166, y: 58, z: 10 }, { x: 174, y: 62, z: 11.5 });

  s = gate().build('rail', 13, 1).build('rail', 13, 10);
  add(s.stream(['crawler', 'armor', 'crawler', 'crawler'], 0.2, 2.5, s.distNearTile(10, 3)), { x: 210, y: 96, z: 6.6 }, { x: 210, y: 96, z: 7.4 });

  s = gate().build('tesla', 9, 6).build('tesla', 7, 4);
  add(s.stream(['runner'], 0.12, 2.5, s.distNearTile(5, 8)), { x: 130, y: 100, z: 10 }, { x: 136, y: 94, z: 11.5 });

  s = gate().build('flamer', 5, 9).build('flamer', 4, 7);
  add(s.stream(['crawler', 'armor', 'crawler'], 0.3, 2.5, s.distNearTile(3, 3)), { x: 80, y: 126, z: 11 }, { x: 86, y: 124, z: 13 });

  s = gate().build('lancer', 12, 6).build('lancer', 14, 5);
  add(s.stream(['brute', 'crawler', 'crawler'], 0.55, 5, s.distNearTile(11, 3)), { x: 206, y: 90, z: 10 }, { x: 210, y: 86, z: 12 });

  s = gate().build('quake', 14, 8).build('quake', 12, 8);
  add(s.stream(['crawler', 'crawler', 'runner'], 0.15, 3, s.distNearTile(13, 3)), { x: 206, y: 128, z: 9 }, { x: 212, y: 132, z: 10.5 });
  return out;
}

function follow(sim: Sim, type: EnemyType, last: Cam, z0: number, z1: number, len: number) {
  return (u: number): Cam => {
    const e = sim.enemies.find((o) => o.type === type);
    if (e) {
      last.x = lerp(last.x, e.x, 0.12);
      last.y = lerp(last.y, e.y - 4, 0.12);
    }
    return { x: last.x, y: last.y, z: lerp(z0, z1, ease(clamp01(u / len))) };
  };
}

function buildShots(): Shot[] {
  const shots: Shot[] = [];
  const full = (a = 6, b = 6.6, dx = 0, dy = 0) => pan({ x: 160, y: 96, z: a }, { x: 160 + dx, y: 96 + dy, z: b });

  // Opening: the whole Gate under attack.
  const open = gate()
    .build('blaster', 2, 4, 2).build('frost', 4, 6, 2).build('mortar', 6, 6, 2).build('tesla', 10, 5, 2)
    .build('rail', 11, 1, 2).build('flamer', 12, 5, 2).build('lancer', 15, 7, 2).build('quake', 14, 8, 2)
    .fill(['crawler', 'crawler', 'runner', 'armor', 'crawler'], 10, 3)
    .stream(['crawler', 'crawler', 'runner', 'armor', 'crawler'], 0.35, 3)
    .warm(1.5);
  const openCam = full(6, 6.8, 8, 4);
  shots.push({ from: T.drop, to: T.montage, sim: open, cam: (u) => openCam(u, 4) });

  montageSims().forEach((m, i) => {
    const from = T.montage + i * BAR;
    shots.push({ from, to: from + BAR, sim: m.sim, cam: m.cam, bars: true });
  });

  const horde = autoDefend(new Sim(2), 9, FIGHTERS, 3, 1).fill(ALL_FOES, 8, 5).stream(ALL_FOES, 0.14, 5).warm(1.5);
  const hordeCam = full(6, 6.5, -6, 2);
  shots.push({ from: T.horde, to: T.maps, sim: horde, cam: (u) => hordeCam(u, 4) });

  MAPS.forEach((_, i) => {
    const foes = ALL_FOES.slice(0, 4 + i);
    const sim = autoDefend(new Sim(i), 8, FIGHTERS, 11 + i, 2).fill(foes, 11, 4).stream(foes, 0.2, 4).warm(1.2);
    const cam = full(6, 6.5, i % 2 ? 8 : -8, 3);
    const from = T.maps + i * T.mapLen;
    shots.push({ from, to: from + T.mapLen, sim, cam: (u) => cam(u, T.mapLen) });
  });

  // The Colossus walking the Coil's top road.
  const boss = autoDefend(new Sim(1), 12, ['blaster', 'tesla', 'rail', 'mortar', 'frost', 'lancer'], 21, 3);
  boss.spawn('boss', boss.distNearTile(4, 2), 30);
  boss.stream(['crawler', 'runner'], 0.7, 1.2).warm(0.4);
  const bossCam = { x: 64, y: 32, z: 9 };
  shots.push({ from: T.boss, to: T.atTheEnd, sim: boss, cam: follow(boss, 'boss', bossCam, 11, 14, 6), bars: true });

  // The Eraser climbing through a wall of towers on the Core.
  const eraser = autoDefend(new Sim(4), 18, FIGHTERS, 33, 3);
  const er = eraser.spawn('eraser', eraser.distNearTile(6, 8), 25);
  eraser.stream(['crawler'], 0.9, 1).warm(0.3);
  (er as unknown as { abilT: number }).abilT = 1.1;
  const eraserCam = { x: er.x, y: er.y, z: 10 };
  shots.push({ from: T.eraser, to: T.finale, sim: eraser, cam: follow(eraser, 'eraser', eraserCam, 9, 13, 4), bars: true });

  // Finale: three maps at full tilt, cut on every bar.
  const finale = [4, 3, 1].map((m, i) => {
    const sim = autoDefend(new Sim(m), 16, [...TOWER_ORDER].filter((t) => t !== 'harvester'), 40 + i, 3)
      .fill(ALL_FOES, 6, 18).stream(ALL_FOES, 0.07, 18);
    sim.speed = 1.6;
    return sim.warm(1);
  });
  for (let i = 0; i < 6; i++) {
    const from = T.finale + i * BAR;
    const cam = i % 2 === 0 ? full(6, 6.7, 0, 0) : pan({ x: 150, y: 90, z: 8.5 }, { x: 170, y: 100, z: 9.8 });
    shots.push({ from, to: from + BAR, sim: finale[i % 3], cam: (u) => cam(u, BAR), bars: i % 2 === 1 });
  }
  return shots;
}

/* -------------------------------------------------------------- the director */

export class Director {
  private shots: Shot[] = [];
  private lastT = -1;
  private grain: HTMLCanvasElement[] = [];
  private scan: HTMLCanvasElement;
  private vignette: HTMLCanvasElement;
  private tile: HTMLCanvasElement;
  private dust: { x: number; y: number; v: number; s: number; c: string }[] = [];
  calm = false; // reduced motion: no shake or glitch, softer flashes

  constructor() {
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 270;
      const g = c.getContext('2d')!;
      const img = g.createImageData(480, 270);
      for (let p = 0; p < img.data.length; p += 4) {
        const v = Math.random() * 255;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.grain.push(c);
    }
    this.scan = document.createElement('canvas');
    this.scan.width = VW;
    this.scan.height = VH;
    const sg = this.scan.getContext('2d')!;
    sg.fillStyle = '#000';
    for (let y = 0; y < VH; y += 4) sg.fillRect(0, y + 2, VW, 2);
    this.vignette = document.createElement('canvas');
    this.vignette.width = VW;
    this.vignette.height = VH;
    const vg = this.vignette.getContext('2d')!;
    const grad = vg.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VW * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    vg.fillStyle = grad;
    vg.fillRect(0, 0, VW, VH);
    this.tile = document.createElement('canvas');
    this.tile.width = 32;
    this.tile.height = 32;
    const r = rng(99);
    this.dust = Array.from({ length: 140 }, () => ({
      x: r() * VW, y: r() * VH, v: 6 + r() * 30, s: r() < 0.2 ? 8 : 4,
      c: r() < 0.15 ? PAL.r0 : r() < 0.5 ? PAL.k2 : PAL.k1,
    }));
  }

  prepare() {
    this.shots = buildShots();
    this.lastT = -1;
  }

  render(g: CanvasRenderingContext2D, t: number) {
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = PAL.k0;
    g.fillRect(0, 0, VW, VH);

    const [sx, sy] = this.shake(t);
    const shot = this.shots.find((s) => t >= s.from && t < s.to);
    const blackScene = !shot && !(t >= T.logo && t < T.drop) && !(t >= T.lineup && t < T.horde) && t < T.outro;
    if (blackScene || (t >= T.logo && t < T.drop) || t >= T.outro) this.drawDust(g, t);

    if (shot) {
      shot.sim.step(dt);
      this.drawShot(g, shot, t - shot.from, sx, sy, t);
    }

    g.save();
    g.translate(sx * 0.5, sy * 0.5);
    this.overlays(g, t);
    g.restore();

    if (shot?.bars) {
      g.fillStyle = PAL.k0;
      g.fillRect(0, 0, VW, BARS);
      g.fillRect(0, VH - BARS, VW, BARS);
    }
    this.barText(g, t);
    this.post(g, t);
    g.restore();
  }

  /* ------------------------------------------------------------ pieces */

  private drawShot(g: CanvasRenderingContext2D, shot: Shot, u: number, sx: number, sy: number, t: number) {
    const cam = shot.cam(u, shot.sim);
    let z = cam.z;
    if (inGroove(t)) {
      const ph = (((t - T.drop) % BEAT) + BEAT) % BEAT;
      z *= 1 + 0.02 * Math.exp(-ph * 9);
    }
    const hw = VW / 2 / z;
    const hh = VH / 2 / z;
    const cx = hw * 2 >= W ? W / 2 : Math.min(W - hw, Math.max(hw, cam.x));
    const cy = hh * 2 >= H ? H / 2 : Math.min(H - hh, Math.max(hh, cam.y));
    const img = shot.sim.render();
    g.save();
    g.translate(Math.round(VW / 2 + sx), Math.round(VH / 2 + sy));
    g.scale(z, z);
    g.translate(-cx, -cy);
    g.drawImage(img, 0, 0);
    g.restore();
  }

  private drawDust(g: CanvasRenderingContext2D, t: number) {
    for (const d of this.dust) {
      const x = (((d.x + t * d.v) % VW) + VW) % VW;
      const y = (d.y + Math.sin(t * 0.5 + d.x) * 10 + VH) % VH;
      g.fillStyle = d.c;
      g.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, d.s, d.s);
    }
  }

  private shake(t: number): [number, number] {
    const hits: [number, number, number][] = [
      [T.impact, 34, 5], [T.drop, 10, 8], [T.boss, 22, 4], [T.boss + 2, 22, 4], [T.boss + 4, 26, 4],
      [T.eraser, 30, 3], [T.finale, 14, 6], [T.outro, 26, 5],
    ];
    let a = 0;
    for (const [at, amp, k] of hits) if (t >= at) a += amp * Math.exp(-(t - at) * k);
    if (t >= T.boss && t < T.atTheEnd) a += 5 * Math.exp(-((t - T.boss) % 1) * 8);
    if (a < 0.5 || this.calm) return [0, 0];
    return [(Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a];
  }

  /* ------------------------------------------------------------ captions */

  private overlays(g: CanvasRenderingContext2D, t: number) {
    for (const c of TYPED) if (t >= c.at - 0.01 && t < c.out) this.typed(g, c, t);
    if (t < T.logo || (t >= T.cut && t < T.outro)) this.hud(g, t);

    if (t >= T.logo && t < T.drop) {
      const u = t - T.logo;
      if (u > 2) this.glow(g, VW / 2, 470, 700, 0.5 * clamp01((u - 2) * 3));
      drawLogo(g, u, VW / 2, 470, 22);
      const k = clamp01((t - 14.6) / 0.4);
      if (k > 0) this.text(g, 'A NEW GAME BY ALEX', VW / 2, 640, 34, PAL.k5, { align: 'center', spacing: 10, alpha: k });
    }

    if (t >= T.drop && t < T.montage) {
      this.slide(g, t - (T.drop + 0.25), () => this.text(g, 'THE STATIC IS COMING', VW / 2, 190, 30, PAL.r2, { align: 'center', spacing: 14 }));
      this.slide(g, t - (T.drop + 1), () => this.text(g, 'DEFEND THE PORTAL.', VW / 2, 880, 104, PAL.k7, { align: 'center', ghost: t - (T.drop + 1) }));
    }

    if (t >= T.montage && t < T.lineup) {
      const i = Math.floor((t - T.montage) / BAR);
      const m = MONTAGE[i];
      const u = t - (T.montage + i * BAR);
      const tag = `TOWER ${String(TOWER_ORDER.indexOf(m.type) + 1).padStart(2, '0')} / 11`;
      this.card(g, u, tag, TOWERS[m.type].name.toUpperCase(), m.line, 0, m.right);
    }

    if (t >= T.lineup && t < T.roster) this.lineup(g, t);
    if (t >= T.roster && t < T.horde) this.roster(g, t);

    if (t >= T.horde && t < T.maps) {
      this.slide(g, t - (T.horde + 0.2), () => this.text(g, 'WAVE AFTER WAVE', VW / 2, 190, 30, PAL.r2, { align: 'center', spacing: 14 }));
      this.slide(g, t - (T.horde + 0.7), () => this.text(g, 'THEY NEVER STOP COMING.', VW / 2, 880, 92, PAL.k7, { align: 'center', ghost: t - (T.horde + 0.7) }));
    }

    if (t >= T.maps && t < T.tapeStop) {
      const i = Math.min(4, Math.floor((t - T.maps) / T.mapLen));
      const u = t - (T.maps + i * T.mapLen);
      this.card(g, u, `ROUND ${i + 1} / 5`, MAPS[i].name.toUpperCase(), '', MAPS[i].skulls);
    }

    if (t >= T.boss && t < T.atTheEnd) {
      const u = t - T.boss;
      this.redPulse(g, Math.exp(-(u % BAR) * 2.5) * 0.55);
      if (u >= 0.25 && u < 3.6) this.banner(g, u - 0.25, 'WAVE 10', 'A COLOSSUS APPROACHES');
      if (u >= 3.7) this.card(g, u - 3.7, 'BOSS', 'COLOSSUS', 'TOUGH. ARMORED. HITS THE PORTAL HARD.');
    }

    if (t >= T.eraser && t < T.finale) this.eraser(g, t - T.eraser);

    if (t >= T.finale && t < T.cut) {
      const i = Math.floor((t - T.finale) / BAR);
      const u = t - (T.finale + i * BAR);
      g.fillStyle = PAL.k0;
      g.globalAlpha = 0.3;
      g.fillRect(0, 0, VW, VH);
      g.globalAlpha = 1;
      if (u < 1.75) {
        const punch = 1 + 0.12 * Math.exp(-(u % BEAT) * 10);
        g.save();
        g.translate(VW / 2, VH / 2);
        g.scale(punch, punch);
        this.text(g, FINALE_WORDS[i], 0, 0, 150, i % 2 ? PAL.r2 : PAL.k7, { align: 'center', ghost: u, shadow: PAL.k0 });
        g.restore();
      }
    }

    if (t >= T.outro) this.endCard(g, t - T.outro);
  }

  private typed(g: CanvasRenderingContext2D, c: (typeof TYPED)[number], t: number) {
    const times = charTimes(c);
    const lh = c.size * 1.45;
    const y0 = (c.y ?? VH / 2) - ((c.lines.length - 1) * lh) / 2;
    const fade = clamp01((c.out - t) / 0.25);
    let cursor: { x: number; y: number } | null = null;
    c.lines.forEach((line, i) => {
      const shown = times[i].filter((at) => at <= t).length;
      g.font = this.font(c.size);
      this.spacing(g, c.size > 100 ? 12 : 4);
      const w = g.measureText(line).width;
      const x = VW / 2 - w / 2;
      const y = y0 + i * lh;
      const red = c.red?.includes(i);
      const s = line.slice(0, shown);
      if (c.size > 100 && s) this.text(g, s, x - 8, y, c.size, PAL.r1, { spacing: 12, alpha: fade * 0.9, shadow: null });
      this.text(g, s, x, y, c.size, red ? PAL.r2 : PAL.k7, { spacing: c.size > 100 ? 12 : 4, alpha: fade });
      if (shown > 0 || i === 0) cursor = { x: x + (s ? g.measureText(s).width + c.size * 0.12 : 0), y };
    });
    if (cursor && Math.floor(t * 3) % 2 === 0) {
      const { x, y } = cursor as { x: number; y: number };
      g.globalAlpha = fade;
      g.fillStyle = PAL.r2;
      g.fillRect(Math.round(x), Math.round(y - c.size * 0.42), Math.round(c.size * 0.5), Math.round(c.size * 0.8));
      g.globalAlpha = 1;
    }
  }

  private hud(g: CanvasRenderingContext2D, t: number) {
    const a = 0.85;
    this.text(g, 'INCOMING TRANSMISSION', 80, 80, 22, PAL.k4, { spacing: 6, alpha: a, shadow: null });
    this.text(g, 'PRIORITY: MAXIMUM', 80, 116, 22, PAL.k5, { spacing: 6, alpha: a, shadow: null });
    if (Math.floor(t * 2) % 2 === 0) {
      g.fillStyle = PAL.r2;
      g.fillRect(VW - 330, 68, 22, 22);
    }
    this.text(g, 'REC', VW - 296, 80, 22, PAL.k5, { spacing: 6, alpha: a, shadow: null });
    const s = Math.floor(t);
    const f = Math.floor((t % 1) * 24);
    const tc = `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    this.text(g, tc, VW - 80, VH - 80, 22, PAL.k4, { align: 'right', spacing: 4, alpha: a, shadow: null });
    this.text(g, 'LAST PIXEL // BUILD 0.1', 80, VH - 80, 22, PAL.k3, { spacing: 6, alpha: a, shadow: null });
  }

  private card(g: CanvasRenderingContext2D, u: number, tag: string, name: string, line: string, skulls = 0, right = false) {
    const k = ease(clamp01(u / 0.22));
    const x = right ? VW - 110 + (1 - k) * 70 : 110 - (1 - k) * 70;
    const align: CanvasTextAlign = right ? 'right' : 'left';
    const shade = g.createLinearGradient(0, VH - 440, 0, VH);
    shade.addColorStop(0, 'rgba(8,8,8,0)');
    shade.addColorStop(1, 'rgba(8,8,8,0.9)');
    g.fillStyle = shade;
    g.fillRect(0, VH - 440, VW, 440);
    this.text(g, tag, x, 712, 28, PAL.r2, { spacing: 10, alpha: k, align });
    this.text(g, name, x, 800, 120, PAL.k7, { alpha: k, ghost: u, spacing: 4, align });
    if (line) this.text(g, line, x + (right ? -4 : 4), 900, 32, PAL.k6, { alpha: clamp01((u - 0.12) / 0.2), spacing: 3, align });
    if (skulls) {
      for (let i = 0; i < 3; i++) this.pixelArt(g, SKULL, x + 6 + i * 64, 880, 7, i < skulls ? PAL.r2 : PAL.k3, clamp01((u - 0.1 - i * 0.08) / 0.1));
    }
  }

  // Real numbers in the letterbox: what the shown tower or round actually is.
  private barText(g: CanvasRenderingContext2D, t: number) {
    let s = '';
    if (t >= T.montage && t < T.lineup) {
      const m = MONTAGE[Math.floor((t - T.montage) / BAR)];
      const L = TOWERS[m.type].levels[2];
      const parts = ['LV 3', `COST ${TOWERS[m.type].levels.reduce((n, l) => n + l.cost, 0)}G`];
      if (L.dmg) parts.push(`DMG ${L.dmg}`);
      parts.push(`RANGE ${L.range}`);
      if (L.splash) parts.push(`SPLASH ${L.splash}`);
      if (L.chains) parts.push(`CHAINS ${L.chains}`);
      if (L.slow) parts.push(`SLOW ${Math.round(L.slow * 100)}%`);
      if (L.stun) parts.push(`STUN ${L.stun}S`);
      if (L.ramp) parts.push(`HEAT x${L.ramp}`);
      if (L.burn) parts.push(`BURN ${L.burn}/S`);
      s = parts.join('    ');
    } else if (t >= T.maps && t < T.tapeStop) {
      const m = MAPS[Math.min(4, Math.floor((t - T.maps) / T.mapLen))];
      s = m.blurb.toUpperCase();
      this.text(g, `LIVES ${m.lives}    GOLD ${m.startGold}`, VW - 110, VH - BARS / 2, 20, PAL.k4, { spacing: 4, shadow: null, align: 'right' });
    } else if (t >= T.boss + 3.7 && t < T.atTheEnd) {
      const b = ENEMIES.boss;
      s = `HP ${b.hp}    ARMOR ${b.armor}    SPEED ${b.speed}    PORTAL DMG ${b.dmg}    BOUNTY ${b.gold}G`;
    } else if (t >= T.eraser + 1.4 && t < T.finale) {
      const b = ENEMIES.eraser;
      s = `HP ${b.hp}    ARMOR ${b.armor}    JAMS TOWERS ${b.jam}S    PORTAL DMG ${b.dmg}`;
    }
    if (s) this.text(g, s, 110, VH - BARS / 2, 20, PAL.k4, { spacing: 4, shadow: null });
  }

  private lineup(g: CanvasRenderingContext2D, t: number) {
    const u = t - T.lineup;
    this.grid(g, t);
    this.text(g, '11 TOWERS', VW / 2, 250, 112, PAL.k7, { align: 'center', ghost: u, spacing: 6 });
    this.text(g, 'THREE LEVELS EACH. UPGRADE EVERYTHING.', VW / 2, 350, 30, PAL.k5, { align: 'center', spacing: 6 });
    const step = 156;
    const x0 = VW / 2 - (step * (TOWER_ORDER.length - 1)) / 2;
    TOWER_ORDER.forEach((type, i) => {
      const k = clamp01((u - i * S16) / 0.12);
      if (k <= 0) return;
      const scale = 6 * (1 + (1 - k) * 0.6);
      const tg = this.tile.getContext('2d')!;
      tg.clearRect(0, 0, 32, 32);
      const aim = -Math.PI / 2 + Math.sin(t * 2 + i) * 0.6;
      drawTowerSprite(tg, type, 3, 8, 8, aim, 0, t, Math.max(0, Math.sin(t * 5 + i)) * 0.3);
      const cx = x0 + i * step;
      g.globalAlpha = k;
      g.drawImage(this.tile, Math.round(cx - 16 * scale), Math.round(590 - 16 * scale), 32 * scale, 32 * scale);
      if (k < 1) {
        g.fillStyle = PAL.k7;
        g.globalAlpha = (1 - k) * 0.8;
        g.fillRect(cx - 48, 542, 96, 96);
      }
      g.globalAlpha = 1;
      this.text(g, TOWERS[type].name.toUpperCase(), cx, i % 2 ? 750 : 712, 18, i % 2 ? PAL.k5 : PAL.k7, { align: 'center', alpha: k, spacing: 2 });
    });
  }

  private roster(g: CanvasRenderingContext2D, t: number) {
    const u = t - T.roster;
    this.grid(g, t);
    g.font = this.font(84);
    this.spacing(g, 6);
    const a = g.measureText('MEET THE ').width;
    const b = g.measureText('STATIC').width;
    const x = VW / 2 - (a + b) / 2;
    this.text(g, 'MEET THE ', x, 170, 84, PAL.k7, { spacing: 6, ghost: u });
    this.text(g, 'STATIC', x + a, 170, 84, PAL.r2, { spacing: 6, ghost: u });
    ROSTER.forEach((type, i) => {
      const k = clamp01((u - 0.25 - i * BEAT * 0.45) / 0.15);
      if (k <= 0) return;
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx = VW / 2 + (col - 1.5) * 420;
      const cy = 420 + row * 360;
      const spr = ENEMY_SPRITES[type];
      const s = Math.round(13 * (1 + (1 - k) * 0.5));
      const frame = Math.floor(t * 5 + i) % 2;
      const img = k < 0.6 ? spr.flash[frame] : spr.frames[frame];
      g.globalAlpha = type === 'wisp' ? 0.6 + Math.sin(t * 9) * 0.25 : 1;
      g.drawImage(img, Math.round(cx - (spr.w * s) / 2), Math.round(cy - (spr.h * s) / 2 - 30), spr.w * s, spr.h * s);
      g.globalAlpha = 1;
      const d = ENEMIES[type];
      this.text(g, d.name.toUpperCase(), cx, cy + 100, 34, PAL.k7, { align: 'center', alpha: k, spacing: 3 });
      this.text(g, d.trait.toUpperCase(), cx, cy + 140, 20, PAL.r2, { align: 'center', alpha: k, spacing: 4 });
      this.text(g, `HP ${d.hp}   SPD ${d.speed}${d.armor ? `   ARMOR ${d.armor}` : ''}`, cx, cy + 172, 16, PAL.k4, { align: 'center', alpha: k, spacing: 3, shadow: null });
    });
  }

  private banner(g: CanvasRenderingContext2D, u: number, top: string, main: string) {
    const k = ease(clamp01(u / 0.25));
    const h = 200 * k;
    const y = 800;
    g.fillStyle = PAL.k0;
    g.globalAlpha = 0.8;
    g.fillRect(0, y - h / 2, VW, h);
    g.globalAlpha = 1;
    g.fillStyle = PAL.r2;
    g.fillRect(0, y - h / 2, VW, 6);
    g.fillRect(0, y + h / 2 - 6, VW, 6);
    if (k < 0.9) return;
    const flick = u < 0.5 && Math.floor(u * 30) % 2 === 0;
    this.text(g, top, VW / 2, y - 46, 34, PAL.k5, { align: 'center', spacing: 10 });
    if (!flick) this.text(g, main, VW / 2, y + 22, 80, PAL.r2, { align: 'center', spacing: 4, ghost: u - 0.3 });
  }

  private eraser(g: CanvasRenderingContext2D, u: number) {
    g.fillStyle = PAL.k0;
    g.globalAlpha = clamp01(u * 2) * 0.25;
    g.fillRect(0, 0, VW, VH);
    g.globalAlpha = 1;
    this.redPulse(g, Math.exp(-u * 1.5) * 0.7);
    if (u >= 0.3) {
      this.text(g, 'THE FINAL BOSS', VW / 2, 170, 28, PAL.k5, { align: 'center', spacing: 14, alpha: clamp01((u - 0.3) * 4) });
      const jitter = u < 0.6 || (u > 1.2 && u < 1.35) || (u > 1.9 && u < 2.05) ? (Math.random() - 0.5) * 40 : 0;
      this.text(g, 'THE ERASER', VW / 2 + jitter, 290, 170, PAL.r2, { align: 'center', ghost: u - 0.3, spacing: 8 });
    }
    if (u >= 1.4) {
      this.slide(g, u - 1.4, () => this.text(g, 'EVERYTHING IT PASSES GOES QUIET.', VW / 2, 880, 44, PAL.k6, { align: 'center', spacing: 5 }));
    }
  }

  private endCard(g: CanvasRenderingContext2D, u: number) {
    const fadeOut = clamp01((END - T.outro - 0.2 - u) / 1.4);
    g.save();
    g.globalAlpha = fadeOut;
    this.glow(g, VW / 2, 420, 760, 0.55);
    const slam = 1 + 0.35 * Math.exp(-u * 10);
    g.save();
    g.translate(VW / 2, 420);
    g.scale(slam, slam);
    drawLogo(g, 99, 0, 0, 24);
    g.restore();
    const k1 = clamp01((u - 0.7) / 0.3);
    this.text(g, 'COMING SOON', VW / 2, 630, 60, PAL.k7, { align: 'center', spacing: 22, alpha: k1 * fadeOut, ghost: u - 0.7 });
    const k2 = clamp01((u - 2.4) / 0.3);
    if (k2 > 0) {
      g.fillStyle = PAL.r2;
      g.globalAlpha = k2 * fadeOut;
      g.fillRect(VW / 2 - 330, 712, 660, 4);
      g.globalAlpha = fadeOut;
      this.text(g, 'GET READY, JAMES.', VW / 2, 770, 40, PAL.r2, { align: 'center', spacing: 10, alpha: k2 * fadeOut });
    }
    const k3 = clamp01((u - 3.8) / 0.5);
    if (k3 > 0) this.text(g, 'A GAME BY ALEX', VW / 2, 1000, 24, PAL.k5, { align: 'center', spacing: 12, alpha: k3 * fadeOut, shadow: null });
    g.restore();
  }

  /* ------------------------------------------------------------ primitives */

  private font(size: number) {
    return `700 ${size}px ${FONT}`;
  }

  private spacing(g: CanvasRenderingContext2D, px: number) {
    (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }

  private text(
    g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string,
    o: { align?: CanvasTextAlign; spacing?: number; alpha?: number; shadow?: string | null; ghost?: number } = {},
  ) {
    if (!s || (o.alpha ?? 1) <= 0) return;
    g.font = this.font(size);
    g.textAlign = o.align ?? 'left';
    g.textBaseline = 'middle';
    this.spacing(g, o.spacing ?? 0);
    const a = o.alpha ?? 1;
    const off = Math.max(3, Math.round(size * 0.07));
    if (o.ghost !== undefined && o.ghost >= 0 && o.ghost < 0.35) {
      // A red echo that snaps into place as the line lands.
      const k = 1 - o.ghost / 0.35;
      g.globalAlpha = a * k;
      g.fillStyle = PAL.r2;
      g.fillText(s, x + k * size * 0.3, y);
    }
    if (o.shadow !== null) {
      g.globalAlpha = a;
      g.fillStyle = o.shadow ?? PAL.k0;
      g.fillText(s, x + off, y + off);
    }
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillText(s, x, y);
    g.globalAlpha = 1;
  }

  private slide(g: CanvasRenderingContext2D, u: number, draw: () => void) {
    if (u < 0) return;
    const k = ease(clamp01(u / 0.25));
    g.save();
    g.globalAlpha = k;
    g.translate(0, (1 - k) * 30);
    draw();
    g.restore();
  }

  private pixelArt(g: CanvasRenderingContext2D, rows: string[], x: number, y: number, s: number, color: string, alpha: number) {
    if (alpha <= 0) return;
    g.globalAlpha = alpha;
    g.fillStyle = color;
    rows.forEach((row, ry) => [...row].forEach((c, rx) => c === '1' && g.fillRect(x + rx * s, y + ry * s, s, s)));
    g.globalAlpha = 1;
  }

  private glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, PAL.r1);
    grad.addColorStop(1, 'rgba(58,7,16,0)');
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  }

  private redPulse(g: CanvasRenderingContext2D, a: number) {
    if (a <= 0.01) return;
    const grad = g.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VW * 0.65);
    grad.addColorStop(0, 'rgba(209,29,50,0)');
    grad.addColorStop(1, 'rgba(209,29,50,0.6)');
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);
    g.globalAlpha = 1;
  }

  private grid(g: CanvasRenderingContext2D, t: number) {
    g.fillStyle = PAL.k1;
    const o = (t * 40) % 64;
    for (let x = -64 + o; x < VW; x += 64) g.fillRect(Math.round(x), 0, 2, VH);
    for (let y = -64 + o; y < VH; y += 64) g.fillRect(0, Math.round(y), VW, 2);
    this.glow(g, VW / 2, VH / 2, 900, 0.25);
  }

  /* ------------------------------------------------------------ post */

  private post(g: CanvasRenderingContext2D, t: number) {
    const glitches: [number, number][] = [
      [8.55, 8.85], [11.5, 11.75], [T.tapeStop, T.tapeStop + 0.25], [63.95, 64.5],
      [65.1, 65.4], [65.9, 66.1], [T.cut - 0.12, T.cut + 0.08],
    ];
    if (!this.calm && glitches.some(([a, b]) => t >= a && t < b)) this.glitch(g);

    const flashes: [number, number, string][] = [
      [T.impact, 1, PAL.k7], [T.drop, 0.7, PAL.k7], [T.lineup, 0.3, PAL.k7], [T.roster, 0.5, PAL.k7],
      [T.horde, 0.45, PAL.k7], [T.boss, 0.6, PAL.r2], [T.eraser, 0.8, PAL.r2], [T.outro, 1, PAL.k7],
    ];
    for (let i = 0; i < 8; i++) flashes.push([T.montage + i * BAR, 0.32, PAL.k7]);
    for (let i = 0; i < 5; i++) flashes.push([T.maps + i * T.mapLen, 0.3, PAL.k7]);
    for (let i = 0; i < 6; i++) flashes.push([T.finale + i * BAR, 0.5, i % 2 ? PAL.r2 : PAL.k7]);
    for (const [at, s, c] of flashes) {
      const d = t - at;
      if (d < 0 || d > 0.5) continue;
      g.globalAlpha = s * Math.exp(-d * 9) * (this.calm ? 0.35 : 1);
      g.fillStyle = c;
      g.fillRect(0, 0, VW, VH);
    }
    g.globalAlpha = 0.07;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.grain[Math.floor(t * 24) % 4], 0, 0, VW, VH);
    g.globalAlpha = 0.16;
    g.drawImage(this.scan, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.vignette, 0, 0);
  }

  private glitch(g: CanvasRenderingContext2D) {
    const c = g.canvas;
    for (let i = 0; i < 9; i++) {
      const y = Math.floor(Math.random() * VH);
      const h = 6 + Math.floor(Math.random() * 70);
      const dx = Math.round((Math.random() - 0.5) * 160);
      g.drawImage(c, 0, y, VW, h, dx, y, VW, h);
      if (Math.random() < 0.4) {
        g.globalAlpha = 0.25;
        g.fillStyle = Math.random() < 0.5 ? PAL.r2 : PAL.k7;
        g.fillRect(0, y, VW, Math.max(2, h / 6));
        g.globalAlpha = 1;
      }
    }
  }
}
