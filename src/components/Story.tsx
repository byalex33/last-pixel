import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { PiPlayFill } from 'react-icons/pi';
import { sfx } from '../game/audio';
import { Btn } from './Btn';

const CHAR_MS = 28;
const PARAGRAPH_MS = 450;
const PAUSES: Record<string, number> = { '.': 260, ',': 110, ':': 160 };

// Title crash timing, in ms. Keep in step with the story-drop keyframes in styles.css.
const DROP_START = 380;
const LETTER_GAP = 75;
const DROP_MS = 460;
const LAND_AT = 0.55; // fraction of the drop where the letter hits
const SETTLE_MS = 420;

interface Props {
  round: number;
  name: string;
  lines: string[];
  onClose: () => void;
}

interface Debris { dx: number; dy: number; x: number; s: number; red: boolean; d: number }

// A round's story: the title crashes in, then the text types out with a key click per letter.
export function Story({ round, name, lines, onClose }: Props) {
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const starts = useMemo(() => {
    let n = 0;
    return lines.map((l) => {
      const s = n;
      n += l.length;
      return s;
    });
  }, [lines]);
  const text = useMemo(() => lines.join(''), [lines]);
  const total = text.length;
  const letters = useMemo(() => [...name], [name]);
  const debris = useMemo<Debris[]>(
    () => Array.from({ length: 22 }, () => ({
      x: Math.random() * 100,
      dx: (Math.random() - 0.5) * 160,
      dy: -20 - Math.random() * 60,
      s: Math.random() < 0.3 ? 6 : 4,
      red: Math.random() < 0.35,
      d: Math.random() * 80,
    })),
    [],
  );

  // stage: 'drop' while letters fall, 'type' once they've landed, then pos runs to total.
  const [stage, setStage] = useState<'drop' | 'type'>(reduced ? 'type' : 'drop');
  const [impact, setImpact] = useState(false);
  const [skipped, setSkipped] = useState(reduced);
  const [pos, setPos] = useState(reduced ? total : 0);
  const done = stage === 'type' && pos >= total;

  // Each letter thuds as it lands; the last one slams the whole box.
  useEffect(() => {
    if (reduced) return;
    const ids: number[] = [];
    const last = letters.length - 1;
    letters.forEach((ch, i) => {
      if (ch === ' ' || i === last) return;
      ids.push(window.setTimeout(() => sfx.play('thump'), DROP_START + i * LETTER_GAP + DROP_MS * LAND_AT));
    });
    const hit = DROP_START + last * LETTER_GAP + DROP_MS * LAND_AT;
    ids.push(window.setTimeout(() => {
      setImpact(true);
      sfx.play('slam');
    }, hit));
    ids.push(window.setTimeout(() => setStage('type'), hit + SETTLE_MS));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [letters, reduced]);

  useEffect(() => {
    if (stage !== 'type' || done) return;
    const prev = text[pos - 1];
    const delay = pos > 0 && starts.includes(pos) ? PARAGRAPH_MS : CHAR_MS + (PAUSES[prev] ?? 0);
    const id = window.setTimeout(() => {
      if (text[pos] !== ' ') sfx.play('type');
      setPos(pos + 1);
    }, delay);
    return () => window.clearTimeout(id);
  }, [stage, pos, done, text, starts]);

  const skip = () => {
    setSkipped(true);
    setImpact(true);
    setStage('type');
    setPos(total);
  };

  // While the story is open, keys skip ahead or close it, and never reach the game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      sfx.unlock();
      if (!done) {
        e.preventDefault();
        skip();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const cls = ['modal', 'story', 'px-box', impact && 'is-impact', skipped && 'is-skipped'].filter(Boolean).join(' ');

  return (
    <div className="overlay story-overlay">
      <div
        className={cls}
        onPointerDown={() => {
          sfx.unlock();
          if (!done) skip();
        }}
      >
        <span className="story-round">Round {round + 1}</span>
        <div className="story-title-wrap">
          <h2 className="story-title" aria-label={name}>
            {letters.map((ch, i) => (
              <span
                key={i}
                aria-hidden
                style={{ '--d': `${DROP_START + i * LETTER_GAP}ms`, '--tilt': `${(i % 3) - 1}deg` } as CSSProperties}
              >
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </h2>
          <span className="story-rule" aria-hidden />
          {impact && !skipped && (
            <div className="story-debris" aria-hidden>
              {debris.map((b, i) => (
                <span
                  key={i}
                  className={b.red ? 'red' : ''}
                  style={{
                    left: `${b.x}%`,
                    width: b.s,
                    height: b.s,
                    '--dx': `${b.dx}px`,
                    '--dy': `${b.dy}px`,
                    animationDelay: `${b.d}ms`,
                  } as CSSProperties}
                />
              ))}
            </div>
          )}
        </div>
        {lines.map((line, i) => {
          const shown = stage === 'type' ? Math.min(line.length, Math.max(0, pos - starts[i])) : 0;
          const caret = stage === 'type' && !done && pos >= starts[i] && pos < starts[i] + line.length;
          return (
            <p key={i}>
              {line.slice(0, shown)}
              {caret && <span className="story-caret" aria-hidden />}
              {/* The untyped rest holds its space so the box never jumps. */}
              <span className="story-hidden">{line.slice(shown)}</span>
            </p>
          );
        })}
        <div className="modal-actions">
          {done ? (
            <Btn variant="primary" className="story-go" onClick={onClose}><PiPlayFill /> Hold the line</Btn>
          ) : (
            <span className="story-skip">Click or press any key to skip</span>
          )}
        </div>
      </div>
    </div>
  );
}
