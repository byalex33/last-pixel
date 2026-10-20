import { useEffect, useRef, useState } from 'react';
import {
  PiArrowCounterClockwiseBold, PiCornersInBold, PiCornersOutBold, PiPlayFill, PiRecordFill, PiSpeakerHighFill,
} from 'react-icons/pi';
import { sfx } from '../game/audio';
import { Director, VH, VW } from './director';
import { Music } from './music';
import { END, T } from './timeline';

// The trailer runs real Games; keep them from overwriting the player's saved campaign.
const setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key: string, value: string) {
  if (key.startsWith('lastpixel.')) return;
  setItem.call(this, key, value);
};

type Phase = 'loading' | 'ready' | 'playing' | 'ended';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const HOLD = T.outro + 5.5; // the frame shown behind the end screen

class Player {
  readonly director = new Director();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private music: Music | null = null;
  private t0 = 0;
  private raf = 0;
  private recorder: MediaRecorder | null = null;

  constructor() {
    this.director.calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private audio() {
    sfx.unlock();
    sfx.muted = false;
    if (this.ctx) return;
    const inner = sfx as unknown as { ctx: AudioContext | null; master: GainNode | null };
    if (!inner.ctx || !inner.master) return;
    const ctx = inner.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(comp);
    comp.connect(ctx.destination);
    // Game sound effects sit under the score.
    inner.master.disconnect();
    inner.master.gain.value = 0.2;
    inner.master.connect(this.out);
    this.music = new Music(ctx, this.out);
    this.ctx = ctx;
  }

  private now() {
    if (!this.ctx) return (performance.now() - this.t0) / 1000;
    return this.ctx.currentTime - this.t0 - (this.ctx.outputLatency || 0);
  }

  // Dev helper: jump the running trailer forward.
  skip(seconds: number) {
    this.t0 -= this.ctx ? seconds : seconds * 1000;
  }

  still(canvas: HTMLCanvasElement, t: number) {
    this.director.render(canvas.getContext('2d')!, t);
  }

  play(canvas: HTMLCanvasElement, record: boolean, onEnd: () => void) {
    this.audio();
    cancelAnimationFrame(this.raf);
    this.director.prepare();
    const g = canvas.getContext('2d')!;
    if (this.ctx) {
      this.t0 = this.ctx.currentTime + 0.2;
      this.music!.start(this.t0);
    } else {
      this.t0 = performance.now() + 200;
    }
    if (record) this.startRecording(canvas);
    const frame = () => {
      const t = this.now();
      if (t >= END) {
        this.stopRecording();
        this.director.render(g, HOLD);
        onEnd();
        return;
      }
      this.director.render(g, Math.max(0, t));
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private startRecording(canvas: HTMLCanvasElement) {
    if (!this.ctx || !this.out) return;
    const dest = this.ctx.createMediaStreamDestination();
    this.out.connect(dest);
    const stream = canvas.captureStream(60);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const mime = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.out?.disconnect(dest);
      const type = rec.mimeType || 'video/webm';
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `last-pixel-trailer.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    rec.start(1000);
    this.recorder = rec;
  }

  private stopRecording() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
  }
}

export function Trailer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [player] = useState(() => new Player());
  const [phase, setPhase] = useState<Phase>('loading');
  const [recording, setRecording] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let live = true;
    const canvas = canvasRef.current!;
    canvas.width = VW;
    canvas.height = VH;
    Promise.all([
      document.fonts.load(`700 64px Silkscreen`),
      document.fonts.load(`400 64px Silkscreen`),
    ]).catch(() => undefined).then(() => {
      if (!live) return;
      player.director.prepare();
      player.still(canvas, 0.2);
      setPhase('ready');
      if (import.meta.env.DEV) {
        // Jump to any moment for inspection: plays every frame up to t silently.
        (window as unknown as { __player: Player }).__player = player;
        // Renders the trailer to an MP4 through a local receiver (see the export notes in exporter.ts).
        Object.assign(window, {
          __export: (o?: object) => import('./exporter').then(async (m) => {
            Object.assign(window, { __exportProgress: m.progress });
            return m.exportVideo(canvas, o);
          }),
        });
        // trailer.html?export=60 renders straight away, for a headless browser.
        const fps = Number(new URLSearchParams(location.search).get('export'));
        if (fps) void (window as unknown as { __export: (o: object) => Promise<unknown> }).__export({ fps });
        let at = Infinity;
        (window as unknown as { __scrub: (t: number) => void }).__scrub = (t: number) => {
          sfx.muted = true;
          if (t < at) {
            player.director.prepare();
            at = 0;
          }
          for (; at < t; at += 1 / 30) player.still(canvas, at);
          player.still(canvas, t);
          at = t;
        };
      }
    });
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      live = false;
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [player]);

  const start = (record = false) => {
    setPhase('playing');
    setRecording(record);
    player.play(canvasRef.current!, record, () => {
      setRecording(false);
      setPhase('ended');
    });
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stageRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="stage" ref={stageRef}>
      <div className="frame">
        <canvas ref={canvasRef} className="screen" aria-label="Last Pixel trailer" />
        {phase === 'ended' && (
          <div className="overlay end">
            <div className="row">
              <button className="btn primary" onClick={() => start()} autoFocus>
                <PiArrowCounterClockwiseBold aria-hidden /> Watch again
              </button>
              {LOCAL && (
                <button className="btn" onClick={() => start(true)} title="Plays the trailer again and saves it as a video file">
                  <PiRecordFill aria-hidden className="red" /> Record video
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {(phase === 'loading' || phase === 'ready') && (
        <div className="overlay start">
          <p className="eyebrow">Incoming transmission</p>
          <h1>
            James<span className="red">,</span>
          </h1>
          <p className="sub">Are you ready?</p>
          <button className="btn primary" onClick={() => start()} disabled={phase === 'loading'} autoFocus>
            <PiPlayFill aria-hidden />
            {phase === 'loading' ? 'Loading' : 'Play trailer'}
          </button>
          <p className="note">
            <PiSpeakerHighFill aria-hidden /> Sound on. 94 seconds.
          </p>
        </div>
      )}

      {recording && (
        <div className="rec" role="status">
          <PiRecordFill aria-hidden /> Recording
        </div>
      )}

      {phase !== 'playing' && (
        <button className="btn icon corner" onClick={toggleFull} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'}>
          {full ? <PiCornersInBold /> : <PiCornersOutBold />}
        </button>
      )}
    </div>
  );
}

