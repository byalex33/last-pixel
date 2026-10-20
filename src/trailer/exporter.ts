import { sfx, type SfxName } from '../game/audio';
import { Director } from './director';
import { Music } from './music';
import { END } from './timeline';

/*
 * Dev only: renders the trailer frame by frame and sends it to a local receiver that pipes it into ffmpeg.
 * Game sound effects are logged while the frames render, then replayed with the score into an
 * OfflineAudioContext, so picture and sound line up exactly.
 */

interface SfxInner {
  ctx: BaseAudioContext | null;
  master: GainNode | null;
  noiseBuf: AudioBuffer | null;
  last: Map<string, number>;
}

export interface ExportOptions {
  fps?: number;
  url?: string;
  quality?: number;
}

export const progress = { frame: 0, frames: 0, stage: 'idle' };

export async function exportVideo(canvas: HTMLCanvasElement, opts: ExportOptions = {}) {
  const fps = opts.fps ?? 60;
  const url = opts.url ?? 'http://localhost:5199';
  const post = (path: string, body?: BodyInit) => fetch(url + path, { method: 'POST', body }).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
  });

  progress.stage = 'preparing';
  const director = new Director();
  director.prepare();

  // Log every sound the shots make, stamped with trailer time.
  const events: [number, SfxName][] = [];
  let now = 0;
  const realPlay = sfx.play;
  sfx.muted = false;
  sfx.play = (name: SfxName) => {
    if (!sfx.muted) events.push([now, name]);
  };

  const g = canvas.getContext('2d')!;
  const frames = Math.round(END * fps);
  progress.frames = frames;
  progress.stage = 'frames';
  await post(`/start?fps=${fps}`);
  try {
    for (let i = 0; i < frames; i++) {
      now = i / fps;
      director.render(g, now);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', opts.quality ?? 0.93));
      await post('/frame', blob);
      progress.frame = i + 1;
    }
  } finally {
    delete (sfx as unknown as { play?: unknown }).play;
  }
  await post('/end');

  progress.stage = 'audio';
  const rate = 48000;
  const off = new OfflineAudioContext(2, Math.ceil((END + 0.5) * rate), rate);
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(off.destination);
  const out = off.createGain();
  out.gain.value = 0.9;
  out.connect(comp);
  new Music(off, out).scheduleAll();

  // Replay the logged effects through the game's own synth, with its clock pinned to each event.
  const inner = sfx as unknown as SfxInner;
  const saved = { ctx: inner.ctx, master: inner.master, noiseBuf: inner.noiseBuf, last: inner.last };
  let cur = 0;
  inner.ctx = new Proxy(off, {
    get(target, prop) {
      if (prop === 'currentTime') return cur;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  inner.master = off.createGain();
  inner.master.gain.value = 0.2;
  inner.master.connect(out);
  inner.noiseBuf = off.createBuffer(1, rate, rate);
  const nd = inner.noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  inner.last = new Map();
  for (const [t, name] of events) {
    cur = t;
    realPlay.call(sfx, name);
  }
  Object.assign(inner, saved);

  const buf = await off.startRendering();
  await post('/audio', wav(buf));
  progress.stage = 'done';
  return { frames, sounds: events.length };
}

function wav(buf: AudioBuffer) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
