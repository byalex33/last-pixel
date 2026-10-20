import { COLS, ROWS } from './constants.js';

export interface MapDef {
  id: string;
  name: string;
  blurb: string;
  difficulty: number; // enemy HP multiplier
  skulls: number; // 1-3 for display
  startGold: number;
  lives: number;
  // Waypoints in tile coordinates. Segments must be axis aligned.
  path: [number, number][];
}

export const MAPS: MapDef[] = [
  {
    id: 'gate',
    name: 'The Gate',
    blurb: 'A winding road to the portal. Learn the ropes here.',
    difficulty: 1,
    skulls: 1,
    startGold: 160,
    lives: 20,
    path: [[-1, 2], [3, 2], [3, 8], [8, 8], [8, 3], [13, 3], [13, 9], [17, 9], [17, 5]],
  },
  {
    id: 'coil',
    name: 'The Coil',
    blurb: 'The road wraps around itself. Towers in the middle see everything.',
    difficulty: 1.25,
    skulls: 2,
    startGold: 150,
    lives: 20,
    path: [[-1, 9], [2, 9], [2, 2], [17, 2], [17, 9], [6, 9], [6, 5], [13, 5], [13, 7]],
  },
  {
    id: 'rift',
    name: 'The Rift',
    blurb: 'A long zigzag, but the horde hits much harder and you have few lives.',
    difficulty: 1.4,
    skulls: 3,
    startGold: 140,
    lives: 15,
    path: [[-1, 1], [16, 1], [16, 4], [3, 4], [3, 7], [16, 7], [16, 10], [18, 10]],
  },
  {
    id: 'hollow',
    name: 'The Hollow',
    blurb: 'A long spiral into grey ground. Menders stitch the horde back together.',
    difficulty: 1.6,
    skulls: 3,
    startGold: 160,
    lives: 15,
    path: [[-1, 10], [18, 10], [18, 1], [1, 1], [1, 7], [15, 7], [15, 4], [5, 4]],
  },
  {
    id: 'core',
    name: 'The Core',
    blurb: 'The heart of the portal. Glitches blink ahead and the Eraser waits at the end.',
    difficulty: 1.85,
    skulls: 3,
    startGold: 170,
    lives: 10,
    path: [[-1, 1], [2, 1], [2, 10], [6, 10], [6, 1], [10, 1], [10, 10], [14, 10], [14, 1], [17, 1], [17, 6]],
  },
];

export const tileKey = (x: number, y: number) => y * COLS + x;

export function pathTiles(map: MapDef): number[] {
  const out: number[] = [];
  for (let i = 1; i < map.path.length; i++) {
    const [x0, y0] = map.path[i - 1];
    const [x1, y1] = map.path[i];
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    for (;;) {
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS) out.push(tileKey(x, y));
      if (x === x1 && y === y1) break;
      x += dx;
      y += dy;
    }
  }
  return out;
}
