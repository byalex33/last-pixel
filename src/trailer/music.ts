import { BAR, BEAT, END, T, TYPED, charTimes } from './timeline';

/*
 * The soundtrack, synthesised on the spot. A minor, 120 BPM, Am - F - C - G.
 * Every sound is placed on the shared trailer clock by a short look-ahead scheduler.
 */

const S16 = BEAT / 4;
const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12); // MIDI note to Hz

// Chord roots (bass, MIDI) and arp tones for each bar of the loop.
const CHORDS = [
  { bass: 33, tones: [69, 72, 76, 81] }, // Am
  { bass: 29, tones: [65, 69, 72, 77] }, // F
  { bass: 36, tones: [72, 76, 79, 84] }, // C
  { bass: 31, tones: [67, 71, 74, 79] }, // G
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
// The hook: one bar per chord, in eighths. 0 is a rest.
const HOOK = [
  [76, 0, 76, 74, 72, 0, 69, 0],
  [72, 0, 72, 74, 76, 0, 72, 0],
  [79, 0, 76, 0, 72, 0, 76, 79],
  [74, 0, 71, 0, 67, 0, 74, 71],
];

const chordAt = (t: number) => CHORDS[((Math.floor((t - T.drop) / BAR) % 4) + 4) % 4];

interface Ev { at: number; fn: (t: number) => void }

export class Music {
  private ctx: BaseAudioContext;
  private bus: GainNode;
  private verb: GainNode;
  private echo: GainNode;
  private noise: AudioBuffer;
  private events: Ev[] = [];
  private idx = 0;
  private t0 = 0;
  private timer = 0;
  private live: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.85;
    this.bus.connect(out);

    // Reverb from a decaying noise impulse.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    conv.buffer = ir;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.55;
    this.verb.connect(conv);
    conv.connect(this.bus);

    // Dotted eighth echo for the arp and lead.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    this.echo = ctx.createGain();
    this.echo.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(this.bus);

    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.compose();
  }

  start(t0: number) {
    this.stop();
    this.t0 = t0;
    this.idx = 0;
    this.bus.gain.cancelScheduledValues(0);
    this.bus.gain.value = 0.85;
    const tick = () => {
      const horizon = this.ctx.currentTime + 0.3;
      while (this.idx < this.events.length && this.t0 + this.events[this.idx].at < horizon) {
        const e = this.events[this.idx++];
        const at = this.t0 + e.at;
        if (at >= this.ctx.currentTime - 0.05) e.fn(Math.max(at, this.ctx.currentTime));
      }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }

  // Places the whole score at once, for rendering into an OfflineAudioContext.
  scheduleAll() {
    for (const e of this.events) e.fn(e.at);
  }

  stop() {
    clearInterval(this.timer);
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live = [];
  }

  /* -------------------------------------------------------------- arrangement */

  private at(at: number, fn: (t: number) => void) {
    this.events.push({ at, fn });
  }

  private compose() {
    // Intro: a low drone under the typed captions.
    this.at(0, (t) => this.drone(t, T.logo + 0.5, 0.11));
    for (const c of TYPED) {
      for (const line of charTimes(c)) for (const at of line) this.at(at, (t) => this.key(t, c.size > 100));
    }
    for (const g of [8.55, 11.5]) this.at(g, (t) => this.glitch(t, 7));

    // Logo: pixels rush in, the last one lands on the drop.
    this.at(T.logo, (t) => this.riser(t, T.impact - T.logo, 0.22));
    this.at(T.logo + 0.1, (t) => this.whoosh(t, 1.3, 0.12));
    this.at(T.impact, (t) => this.impact(t, 1));
    this.at(T.impact, (t) => this.pad(t, [57, 60, 64, 71], 2.2, 0.05));
    this.at(T.drop - 1, (t) => this.reverse(t, 1, 0.16));

    // Groove from the drop to the tape stop, then the finale.
    for (let t = T.drop; t < T.tapeStop - 1e-6; t += S16) this.grooveStep(t, false);
    for (let t = T.finale; t < T.cut - 1e-6; t += S16) this.grooveStep(t, true);
    for (const c of [T.drop, T.montage, 28, T.roster, T.horde, T.maps]) this.at(c, (t) => this.crash(t, 0.3));
    for (let c = T.finale; c < T.cut; c += BAR * 2) this.at(c, (t) => this.crash(t, 0.32));
    for (let t = T.roster; t < T.maps; t += BAR) {
      const ch = chordAt(t);
      this.at(t, (at) => this.pad(at, ch.tones.map((n) => n - 12), BAR, 0.028));
    }
    this.at(T.lineup, (t) => this.riser(t, BAR, 0.12));
    this.at(T.tapeStop, (t) => this.powerDown(t));

    // Heartbeat, then the Colossus.
    for (const h of [T.everyTen, T.everyTen + 1]) {
      this.at(h, (t) => this.kick(t, 0.9, 90));
      this.at(h + 0.22, (t) => this.kick(t, 0.6, 80));
    }
    this.at(T.everyTen, (t) => this.drone(t, 2.2, 0.08));
    const roots = [33, 29, 34];
    roots.forEach((r, i) => this.at(T.boss + i * BAR, (t) => this.braam(t, NOTE(r), 2.1, 0.32)));
    for (let t = T.boss; t < T.atTheEnd; t += BEAT * 2) {
      this.at(t, (at) => this.kick(at, 1, 140));
      if (Math.round((t - T.boss) / (BEAT * 2)) % 2 === 1) this.at(t, (at) => this.snare(at, 0.75, 0.7));
    }
    for (let i = 0; i < 6; i++) this.at(T.atTheEnd - 0.75 + i * S16, (t) => this.tom(t, 160 - i * 18));

    // The Eraser.
    this.at(T.atTheEnd, (t) => this.drone(t, 2, 0.1));
    this.at(T.atTheEnd, (t) => this.tension(t, 2));
    this.at(T.eraser, (t) => this.braam(t, NOTE(34), 3.2, 0.36));
    this.at(T.eraser, (t) => this.braam(t, NOTE(33), 3.2, 0.2));
    this.at(T.eraser, (t) => this.impact(t, 0.8));
    for (const g of [T.eraser + 0.05, T.eraser + 1.2, T.eraser + 1.9]) this.at(g, (t) => this.glitch(t, 9));
    this.at(T.eraser + 2, (t) => this.riser(t, 2, 0.26));
    for (let i = 0; i < 16; i++) this.at(T.finale - BAR + i * S16, (t) => this.snare(t, 0.15 + i * 0.035, 0.2));

    // Hard stop, the question, the logo.
    this.at(T.cut, (t) => this.powerDown(t));
    this.at(T.cut + 0.6, (t) => this.drone(t, T.outro - T.cut - 0.4, 0.06));
    this.at(T.outro - 1.5, (t) => this.riser(t, 1.5, 0.25));
    this.at(T.outro, (t) => this.impact(t, 1.1));
    this.at(T.outro, (t) => this.pad(t, [45, 57, 64, 71, 72], END - T.outro, 0.06));
    for (let i = 0; i < 24; i++) {
      const tones = [69, 72, 76, 81, 83, 81, 76, 72];
      this.at(T.outro + 0.5 + i * BEAT * 0.5, (t) => this.arp(t, NOTE(tones[i % 8] + 12), 0.05 * (1 - i / 26)));
    }
    this.at(T.outro + 2.5, (t) => this.chime(t));

    this.events.sort((a, b) => a.at - b.at);
  }

  private grooveStep(t: number, hot: boolean) {
    const i = Math.round((t - T.drop) / S16);
    const s = ((i % 16) + 16) % 16; // step within the bar
    const ch = chordAt(t);
    const fillBar = t >= T.lineup && t < T.roster;
    if (s % 4 === 0) this.at(t, (at) => this.kick(at, 1));
    if (fillBar) {
      const k = (t - T.lineup) / BAR;
      this.at(t, (at) => this.snare(at, 0.18 + k * 0.5, 0.15));
    } else if (s === 4 || s === 12) {
      this.at(t, (at) => this.snare(at, 0.6, 0.25));
    }
    if (hot && (s === 4 || s === 12)) this.at(t + 0.01, (at) => this.snare(at, 0.3, 0.1));
    if (hot ? s % 2 === 1 || s % 4 === 2 : s % 4 === 2) this.at(t, (at) => this.hat(at, s % 4 === 2 ? 0.16 : 0.08, false));
    if (s === 14 && !hot) this.at(t, (at) => this.hat(at, 0.12, true));
    // Bass: pumping eighths (sixteenths in the finale), octave on the offbeat.
    if (hot || s % 2 === 0) {
      const up = hot ? s % 2 === 1 : s % 4 === 2;
      this.at(t, (at) => this.bass(at, NOTE(ch.bass + (up ? 12 : 0)), hot ? S16 * 0.9 : S16 * 1.8, 0.3));
    }
    if (t >= T.montage) {
      const n = ch.tones[ARP[s]] + (hot ? 12 : 0);
      this.at(t, (at) => this.arp(at, NOTE(n), hot ? 0.055 : 0.05));
    }
    const hook = (t >= T.roster && t < T.maps) || (hot && t >= T.finale + BAR * 2);
    if (hook && s % 2 === 0) {
      const bar = ((Math.floor((t - T.drop) / BAR) % 4) + 4) % 4;
      const n = HOOK[bar][s / 2];
      if (n) this.at(t, (at) => this.lead(at, NOTE(n + (hot ? 12 : 0)), S16 * 1.7, hot ? 0.07 : 0.08));
    }
  }

  /* -------------------------------------------------------------- instruments */

  private osc(type: OscillatorType, f: number, t: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o);
    return o;
  }

  private noiseSrc(t: number, dur: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
    this.track(s);
    return s;
  }

  private track(s: AudioScheduledSourceNode) {
    this.live.push(s);
    s.onended = () => {
      const i = this.live.indexOf(s);
      if (i >= 0) this.live.splice(i, 1);
    };
  }

  private gain(v: number, ...to: AudioNode[]) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    for (const n of to) g.connect(n);
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private decay(g: GainNode, t: number, v: number, dur: number, attack = 0.002) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  kick(t: number, v = 1, f0 = 160) {
    const o = this.osc('sine', f0, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = this.gain(0, this.bus);
    this.decay(g, t, v * 0.95, 0.45);
    o.connect(g);
    const n = this.noiseSrc(t, 0.02);
    const ng = this.gain(0, this.bus);
    this.decay(ng, t, v * 0.25, 0.02);
    n.connect(this.filter('highpass', 3000)).connect(ng);
  }

  snare(t: number, v = 0.6, wet = 0.25) {
    const n = this.noiseSrc(t, 0.25);
    const g = this.gain(0, this.bus, this.gain(wet, this.verb));
    this.decay(g, t, v, 0.2);
    n.connect(this.filter('bandpass', 1900, 0.6)).connect(g);
    const o = this.osc('triangle', 220, t, 0.12);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const og = this.gain(0, this.bus);
    this.decay(og, t, v * 0.5, 0.11);
    o.connect(og);
  }

  tom(t: number, f: number) {
    const o = this.osc('sine', f, t, 0.35);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.3);
    const g = this.gain(0, this.bus, this.gain(0.3, this.verb));
    this.decay(g, t, 0.6, 0.32);
    o.connect(g);
  }

  hat(t: number, v: number, open: boolean) {
    const n = this.noiseSrc(t, open ? 0.3 : 0.05);
    const g = this.gain(0, this.bus);
    this.decay(g, t, v, open ? 0.26 : 0.04);
    n.connect(this.filter('highpass', 7500)).connect(g);
  }

  crash(t: number, v: number) {
    const n = this.noiseSrc(t, 1.8);
    const g = this.gain(0, this.bus, this.gain(0.4, this.verb));
    this.decay(g, t, v, 1.7);
    n.connect(this.filter('highpass', 4200)).connect(g);
  }

  bass(t: number, f: number, dur: number, v: number) {
    const lp = this.filter('lowpass', 1400, 5);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.gain(0, this.bus);
    this.decay(g, t, v, dur + 0.04, 0.004);
    lp.connect(g);
    this.osc('sawtooth', f, t, dur).connect(lp);
    const sub = this.osc('sine', f, t, dur);
    const sg = this.gain(0, this.bus);
    this.decay(sg, t, v * 0.9, dur + 0.04, 0.004);
    sub.connect(sg);
  }

  arp(t: number, f: number, v: number) {
    const g = this.gain(0, this.bus, this.echo);
    this.decay(g, t, v, 0.14);
    this.osc('square', f, t, 0.15).connect(this.filter('lowpass', 3600)).connect(g);
  }

  lead(t: number, f: number, dur: number, v: number) {
    const lp = this.filter('lowpass', 2800, 2);
    const g = this.gain(0, this.bus, this.echo, this.gain(0.25, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.setValueAtTime(v, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    lp.connect(g);
    for (const d of [-8, 8]) {
      const o = this.osc('sawtooth', f, t, dur + 0.1);
      o.detune.value = d;
      o.connect(lp);
    }
  }

  pad(t: number, notes: number[], dur: number, v: number) {
    const lp = this.filter('lowpass', 1100);
    const g = this.gain(0, this.bus, this.gain(0.8, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.5, dur * 0.3));
    g.gain.setValueAtTime(v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(g);
    for (const n of notes) {
      for (const d of [-11, 11]) {
        const o = this.osc('sawtooth', NOTE(n), t, dur + 0.7);
        o.detune.value = d;
        o.connect(lp);
      }
    }
  }

  braam(t: number, f: number, dur: number, v: number) {
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    const lp = this.filter('lowpass', 120, 3);
    lp.frequency.setValueAtTime(120, t);
    lp.frequency.exponentialRampToValueAtTime(1700, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = this.gain(0, this.bus, this.gain(0.5, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.04);
    g.gain.setValueAtTime(v, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    shaper.connect(lp).connect(g);
    for (const [m, d] of [[1, -9], [1, 9], [2, -6], [2, 7], [3, 0]]) {
      const o = this.osc('sawtooth', f * m, t, dur);
      o.detune.value = d;
      o.connect(shaper);
    }
    const sub = this.osc('sine', f, t, dur);
    const sg = this.gain(0, this.bus);
    this.decay(sg, t, v * 1.6, dur, 0.02);
    sub.connect(sg);
  }

  impact(t: number, v: number) {
    const o = this.osc('sine', 95, t, 1.8);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const g = this.gain(0, this.bus);
    this.decay(g, t, v * 1.1, 1.8);
    o.connect(g);
    const n = this.noiseSrc(t, 1.6);
    const lp = this.filter('lowpass', 1800);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.4);
    const ng = this.gain(0, this.bus, this.gain(0.7, this.verb));
    this.decay(ng, t, v * 0.55, 1.5);
    n.connect(lp).connect(ng);
    this.crash(t, v * 0.35);
  }

  riser(t: number, dur: number, v: number) {
    const n = this.noiseSrc(t, dur);
    const bp = this.filter('bandpass', 300, 1.8);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = this.gain(0, this.bus, this.gain(0.3, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g);
    const o = this.osc('sawtooth', 110, t, dur);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = this.gain(0, this.bus);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v * 0.18, t + dur * 0.97);
    og.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(this.filter('lowpass', 2000)).connect(og);
  }

  reverse(t: number, dur: number, v: number) {
    const n = this.noiseSrc(t, dur);
    const g = this.gain(0, this.bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + dur);
    g.gain.setValueAtTime(0, t + dur);
    n.connect(this.filter('highpass', 3000)).connect(g);
  }

  whoosh(t: number, dur: number, v: number) {
    const n = this.noiseSrc(t, dur);
    const bp = this.filter('bandpass', 4000, 1.2);
    bp.frequency.exponentialRampToValueAtTime(350, t + dur);
    const g = this.gain(0, this.bus, this.gain(0.4, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g);
  }

  drone(t: number, dur: number, v: number) {
    const lp = this.filter('lowpass', 260, 4);
    const lfo = this.osc('sine', 0.25, t, dur);
    const depth = this.gain(120);
    lfo.connect(depth).connect(lp.frequency);
    const g = this.gain(0, this.bus, this.gain(0.4, this.verb));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(1.5, dur * 0.4));
    g.gain.setValueAtTime(v, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    for (const [f, d] of [[55, -6], [55, 6], [82.4, 3]]) {
      const o = this.osc('sawtooth', f, t, dur);
      o.detune.value = d;
      o.connect(lp);
    }
    const hiss = this.noiseSrc(t, dur);
    const hg = this.gain(0, this.bus);
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(v * 0.12, t + dur * 0.3);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    hiss.connect(this.filter('highpass', 6000)).connect(hg);
  }

  tension(t: number, dur: number) {
    const o = this.osc('sine', 1760, t, dur);
    o.frequency.linearRampToValueAtTime(1864, t + dur);
    const g = this.gain(0, this.bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + dur);
    g.gain.setValueAtTime(0, t + dur);
    o.connect(g);
  }

  key(t: number, heavy: boolean) {
    const o = this.osc('square', heavy ? 520 : 1300 + Math.random() * 300, t, 0.04);
    const g = this.gain(0, this.bus, this.gain(0.2, this.verb));
    this.decay(g, t, heavy ? 0.12 : 0.05, heavy ? 0.09 : 0.03);
    o.connect(g);
    if (heavy) this.kick(t, 0.5, 120);
  }

  glitch(t: number, n: number) {
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.035 + Math.random() * 0.01;
      const o = this.osc('square', 150 + Math.random() * 2400, at, 0.03);
      const g = this.gain(0, this.bus);
      this.decay(g, at, 0.05, 0.03);
      o.connect(g);
    }
  }

  powerDown(t: number) {
    const o = this.osc('sawtooth', 420, t, 0.7);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.65);
    const g = this.gain(0, this.bus);
    this.decay(g, t, 0.18, 0.7);
    o.connect(this.filter('lowpass', 1600)).connect(g);
  }

  chime(t: number) {
    for (const [n, d] of [[81, 0], [88, 0.12], [93, 0.24]]) {
      const g = this.gain(0, this.bus, this.gain(0.7, this.verb));
      this.decay(g, t + d, 0.06, 1.4);
      this.osc('triangle', NOTE(n), t + d, 1.4).connect(g);
    }
  }
}
