export type SfxName =
  | 'shoot' | 'thump' | 'boom' | 'rail' | 'zap' | 'frost' | 'die' | 'bigdie'
  | 'leak' | 'build' | 'upgrade' | 'sell' | 'wave' | 'boss' | 'clear'
  | 'click' | 'error' | 'win' | 'lose'
  | 'flame' | 'laser' | 'mine' | 'quake' | 'coin' | 'jam' | 'type' | 'slam';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  muted = false;

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        return;
      }
    }
    // Browsers start audio suspended until a user gesture; also covers Safari's 'interrupted'.
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  // Create the audio context straight away: where autoplay is allowed, sound works from the
  // very first frame (loader and story included). Where it isn't, the context waits suspended,
  // and any click, tap or key press anywhere resumes it. Stays armed in case audio is suspended later.
  armUnlock() {
    this.unlock();
    const onGesture = () => {
      if (!this.running) this.unlock();
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click']) {
      window.addEventListener(ev, onGesture, true);
    }
    // Returning to the tab can leave the context suspended on some browsers.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx && !this.running) void this.ctx.resume().catch(() => {});
    });
  }

  private gate(name: string, gap: number) {
    // Skip sounds while suspended, or they all pile up and fire at once on resume.
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < gap) return false;
    this.last.set(name, now);
    return true;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: SfxName) {
    switch (name) {
      case 'shoot':
        if (this.gate(name, 0.05)) this.tone(900 + Math.random() * 120, 300, 0.06, 'square', 0.035);
        break;
      case 'thump':
        if (this.gate(name, 0.08)) this.tone(160, 60, 0.12, 'square', 0.06);
        break;
      case 'boom':
        if (this.gate(name, 0.07)) {
          this.noise(0.3, 0.35, 900);
          this.tone(110, 35, 0.25, 'triangle', 0.15);
        }
        break;
      case 'rail':
        if (this.gate(name, 0.08)) {
          this.tone(2200, 120, 0.3, 'sawtooth', 0.05);
          this.noise(0.12, 0.12, 4000);
        }
        break;
      case 'zap':
        if (this.gate(name, 0.07)) {
          this.tone(600 + Math.random() * 600, 1800, 0.08, 'sawtooth', 0.035);
          this.noise(0.08, 0.08, 6000);
        }
        break;
      case 'frost':
        if (this.gate(name, 0.15)) this.tone(1400, 2200, 0.15, 'triangle', 0.035);
        break;
      case 'flame':
        if (this.gate(name, 0.12)) this.noise(0.14, 0.07, 1800);
        break;
      case 'laser':
        if (this.gate(name, 0.16)) this.tone(1500 + Math.random() * 100, 1400, 0.15, 'sawtooth', 0.018);
        break;
      case 'mine':
        if (this.gate(name, 0.1)) {
          this.tone(500, 250, 0.05, 'square', 0.04);
          this.tone(900, 900, 0.03, 'square', 0.03, 0.42);
        }
        break;
      case 'quake':
        if (this.gate(name, 0.15)) {
          this.tone(70, 28, 0.4, 'triangle', 0.22);
          this.noise(0.35, 0.25, 500);
        }
        break;
      case 'slam':
        if (this.gate(name, 0.3)) {
          this.tone(95, 24, 0.7, 'triangle', 0.32);
          this.tone(60, 30, 0.25, 'square', 0.12);
          this.noise(0.55, 0.45, 1600);
        }
        break;
      case 'type':
        if (this.gate(name, 0.035)) {
          this.tone(1100 + Math.random() * 500, 700, 0.025, 'square', 0.022);
          this.noise(0.02, 0.03, 5000);
        }
        break;
      case 'jam':
        if (this.gate(name, 0.5)) {
          this.noise(0.6, 0.18, 3000);
          this.tone(400, 40, 0.5, 'sawtooth', 0.06);
        }
        break;
      case 'coin':
        if (this.gate(name, 0.2)) [988, 1319].forEach((f, i) => this.tone(f, f, 0.08, 'square', 0.04, i * 0.07));
        break;
      case 'die':
        if (this.gate(name, 0.035)) this.tone(320, 60, 0.09, 'square', 0.035);
        break;
      case 'bigdie':
        if (this.gate(name, 0.2)) {
          this.noise(0.9, 0.5, 1200);
          this.tone(90, 20, 0.9, 'sawtooth', 0.2);
        }
        break;
      case 'leak':
        if (this.gate(name, 0.15)) this.tone(180, 40, 0.45, 'sawtooth', 0.12);
        break;
      case 'build':
        if (this.gate(name, 0.05)) {
          this.tone(330, 330, 0.06, 'square', 0.05);
          this.tone(660, 660, 0.08, 'square', 0.05, 0.06);
        }
        break;
      case 'upgrade':
        if (this.gate(name, 0.05)) [440, 554, 659, 880].forEach((f, i) => this.tone(f, f, 0.07, 'square', 0.045, i * 0.05));
        break;
      case 'sell':
        if (this.gate(name, 0.05)) this.tone(880, 220, 0.18, 'square', 0.045);
        break;
      case 'wave':
        if (this.gate(name, 0.3)) [220, 220, 330].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.06, i * 0.14));
        break;
      case 'boss':
        if (this.gate(name, 0.3)) {
          [110, 104, 98].forEach((f, i) => this.tone(f, f * 0.98, 0.35, 'sawtooth', 0.12, i * 0.38));
        }
        break;
      case 'clear':
        if (this.gate(name, 0.3)) [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.1, 'square', 0.045, i * 0.08));
        break;
      case 'click':
        if (this.gate(name, 0.03)) this.tone(1200, 1200, 0.025, 'square', 0.03);
        break;
      case 'error':
        if (this.gate(name, 0.1)) this.tone(140, 110, 0.14, 'square', 0.06);
        break;
      case 'win':
        if (this.gate(name, 1)) [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, f, 0.16, 'square', 0.05, i * 0.13));
        break;
      case 'lose':
        if (this.gate(name, 1)) [330, 277, 233, 165].forEach((f, i) => this.tone(f, f * 0.97, 0.3, 'sawtooth', 0.07, i * 0.25));
        break;
    }
  }
}

export const sfx = new Sfx();
sfx.armUnlock();
if (import.meta.env.DEV) (window as unknown as { __sfx: Sfx }).__sfx = sfx;
