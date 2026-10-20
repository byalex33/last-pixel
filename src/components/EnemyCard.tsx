import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  PiArrowsSplitBold, PiCoinsFill, PiCrownFill, PiFireFill, PiFirstAidFill, PiGhostFill, PiHeartBreakFill,
  PiLightningSlashFill, PiShieldFill, PiSneakerMoveFill, PiSnowflakeFill, PiStarFourFill, PiWaveformFill,
} from 'react-icons/pi';
import { ENEMIES } from '../game/data';
import type { Enemy, Game } from '../game/engine';
import { enemyIcon } from '../game/sprites';

interface View {
  id: number;
  hp: number;
  status: string; // compact key so the card only re-renders when something visible changes
}

function speedLabel(px: number) {
  return px < 15 ? 'Slow' : px < 26 ? 'Steady' : 'Fast';
}

function abilities(e: Enemy): { icon: ReactNode; text: string }[] {
  const def = ENEMIES[e.type];
  const out: { icon: ReactNode; text: string }[] = [];
  if (def.boss) out.push({ icon: <PiCrownFill />, text: 'Boss: shrugs off most knockback and cannot be stunned' });
  if (def.jam) out.push({ icon: <PiLightningSlashFill />, text: `Shuts down towers within 3 tiles for ${def.jam}s every few seconds` });
  if (def.heal) out.push({ icon: <PiFirstAidFill />, text: `Heals nearby foes by ${Math.round(def.heal * 100)}% of their health every 2.5s` });
  if (def.blink) out.push({ icon: <PiWaveformFill />, text: `Blinks ${(def.blink / 16).toFixed(1)} tiles forward every few seconds` });
  if (e.armor > 0) out.push({ icon: <PiShieldFill />, text: `Armor ${e.armor}: blocks ${e.armor} damage per hit. Burns and lasers ignore it` });
  if (def.splits) out.push({ icon: <PiArrowsSplitBold />, text: `Splits into ${def.splits} Runners on death` });
  if (def.slowImmune) out.push({ icon: <PiGhostFill />, text: 'Immune to slow. Quake still knocks it back' });
  return out;
}

// Floating info card for the enemy under the cursor (or tapped on touch).
export function EnemyCard({ game, scale }: { game: Game; scale: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = game.inspected;
      const next: View | null = e
        ? {
            id: e.id,
            hp: Math.max(0, Math.ceil(e.hp)),
            status: `${e.slowT > 0 ? Math.round(e.slow * 100) : 0}|${e.burnT > 0 ? Math.round(e.burn) : 0}|${e.stunT > 0 ? 1 : 0}`,
          }
        : null;
      const prev = viewRef.current;
      if (next?.id !== prev?.id || next?.hp !== prev?.hp || next?.status !== prev?.status) {
        viewRef.current = next;
        setView(next);
      }
      // Follow the enemy every frame without re-rendering.
      const card = cardRef.current;
      const wrap = card?.parentElement;
      if (!e || !card || !wrap) return;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const ww = wrap.clientWidth;
      const left = Math.min(Math.max(4, e.x * scale - cw / 2), ww - cw - 4);
      const above = (e.y - e.h / 2 - 4) * scale - ch;
      const top = above >= 4 ? above : (e.y + e.h / 2 + 4) * scale;
      card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      card.style.visibility = 'visible';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, scale]);

  const e = view ? game.inspected : undefined;
  if (!view || !e) return null;
  const def = ENEMIES[e.type];
  const pct = Math.max(0, Math.min(100, (view.hp / e.maxHp) * 100));
  const statuses: { icon: ReactNode; text: string }[] = [];
  if (e.stunT > 0) statuses.push({ icon: <PiStarFourFill />, text: 'Stunned' });
  if (e.burnT > 0) statuses.push({ icon: <PiFireFill />, text: `Burning ${Math.round(e.burn)}/s` });
  if (e.slowT > 0) statuses.push({ icon: <PiSnowflakeFill />, text: `Slowed ${Math.round(e.slow * 100)}%` });
  const abil = abilities(e);

  return (
    <div className="enemy-card px-box" ref={cardRef} role="tooltip" style={{ visibility: 'hidden' }}>
      <div className="ec-head">
        <span className="enemy-frame">
          <img src={enemyIcon(e.type)} alt="" className="pixel" />
        </span>
        <div>
          <h4>{def.name}</h4>
          <span className="ec-trait">{def.trait}</span>
        </div>
      </div>
      <p className="ec-desc">{def.desc}</p>
      <div className="ec-hp">
        <div className="ec-bar"><span style={{ width: `${pct}%` }} /></div>
        <span>{view.hp} / {Math.round(e.maxHp)}</span>
      </div>
      <dl className="ec-stats">
        <div><dt><PiSneakerMoveFill /> Speed</dt><dd>{speedLabel(def.speed)}</dd></div>
        <div><dt><PiShieldFill /> Armor</dt><dd>{e.armor || 'None'}</dd></div>
        <div><dt><PiCoinsFill /> Bounty</dt><dd>{e.gold}</dd></div>
        <div><dt><PiHeartBreakFill /> Leak</dt><dd className="red">-{e.dmg} {e.dmg === 1 ? 'life' : 'lives'}</dd></div>
      </dl>
      {abil.length > 0 && (
        <ul className="ec-list">
          {abil.map((a) => <li key={a.text}>{a.icon}<span>{a.text}</span></li>)}
        </ul>
      )}
      {statuses.length > 0 && (
        <div className="ec-status">
          {statuses.map((s) => <span key={s.text}>{s.icon}{s.text}</span>)}
        </div>
      )}
    </div>
  );
}
