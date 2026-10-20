// Seeded random numbers for everything that changes the outcome of a run, so the server can
// replay a recorded run and land on exactly the same result. Cosmetic effects use Math.random.
export class Rng {
  readonly seed: number;
  private s: number;
  // How many numbers have been drawn. A run can only take a new seed before the first draw.
  draws = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }

  // mulberry32: integer maths only, so every JS engine produces the same sequence.
  next() {
    this.draws++;
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export const randomSeed = () => (Math.random() * 4294967296) >>> 0;
