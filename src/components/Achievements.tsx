import { useEffect, type ReactNode } from 'react';
import {
  PiArrowFatUpFill, PiCastleTurretFill, PiCoinsFill, PiCrownFill, PiDoorOpenFill, PiDropFill, PiFlagFill,
  PiHandPalmFill, PiHeartBreakFill, PiInfinityBold, PiLockSimpleFill, PiQuestionBold, PiShieldCheckFill,
  PiSkullFill, PiSparkleFill, PiSpiralBold, PiStarFill, PiSunFill, PiTrafficConeFill, PiTrophyFill, PiXBold,
  PiMoonFill,
} from 'react-icons/pi';
import { ACHIEVEMENTS, KILLS_GOAL, type AchievementId } from '../game/achievements';
import type { Game } from '../game/engine';
import { loadAchievements } from '../game/storage';
import { Btn } from './Btn';

const ICONS: Record<AchievementId, ReactNode> = {
  first_blood: <PiDropFill />,
  clear_gate: <PiDoorOpenFill />,
  clear_coil: <PiSpiralBold />,
  clear_rift: <PiMoonFill />,
  clear_hollow: <PiFlagFill />,
  clear_core: <PiSunFill />,
  giant_slayer: <PiCrownFill />,
  flawless: <PiShieldCheckFill />,
  by_a_thread: <PiHeartBreakFill />,
  maxed: <PiArrowFatUpFill />,
  arsenal: <PiCastleTurretFill />,
  hoarder: <PiCoinsFill />,
  perked_up: <PiStarFill />,
  road_works: <PiTrafficConeFill />,
  not_so_fast: <PiHandPalmFill />,
  thousand_cuts: <PiSkullFill />,
  endless_40: <PiInfinityBold />,
  legendary: <PiSparkleFill />,
};

const byId = (id: AchievementId) => ACHIEVEMENTS.find((a) => a.id === id)!;

// Pop-ups for achievements just unlocked; each clears itself after a few seconds.
// Docked, they sit in a dialog's flow above its box instead, and stay until the dialog goes.
export function AwardToasts({ game, docked }: { game: Game; docked?: boolean }) {
  if (!game.awards.length) return null;
  return (
    <div className={`award-stack${docked ? ' is-docked' : ''}`} aria-live="polite">
      {(docked ? game.awards : game.awards.slice(0, 3)).map((a) => (
        <AwardToast key={a.key} id={a.id} onDone={docked ? undefined : () => game.dismissAward(a.key)} />
      ))}
    </div>
  );
}

function AwardToast({ id, onDone }: { id: AchievementId; onDone?: () => void }) {
  useEffect(() => {
    if (!onDone) return;
    const t = window.setTimeout(onDone, 4500);
    return () => window.clearTimeout(t);
    // Only the first mount starts the clock; onDone is a fresh closure on every render.
  }, []);
  const def = byId(id);
  return (
    <div className={`award px-box${def.secret ? ' is-legendary' : ''}`} role="status">
      <span className="award-icon">{ICONS[id]}</span>
      <div>
        <span className="award-kicker"><PiTrophyFill /> Achievement unlocked</span>
        <strong className={def.secret ? 'legendary-text' : undefined}>{def.name}</strong>
      </div>
    </div>
  );
}

export function AchievementsModal({ onClose }: { onClose: () => void }) {
  const save = loadAchievements();
  const got = new Set(save.unlocked);
  const count = ACHIEVEMENTS.filter((a) => got.has(a.id)).length;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal px-box achievements"
        role="dialog"
        aria-labelledby="achievements-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="achievements-head">
          <h2 id="achievements-title"><PiTrophyFill /> Achievements</h2>
          <Btn variant="ghost" onClick={onClose} aria-label="Close" autoFocus>
            <PiXBold />
          </Btn>
        </div>
        <p className="achievements-sum">
          {count} of {ACHIEVEMENTS.length} unlocked. Foes destroyed: {Math.min(save.kills, KILLS_GOAL).toLocaleString('en')} / {KILLS_GOAL.toLocaleString('en')}
        </p>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }} />
        </div>
        <ul className="achievement-list">
          {ACHIEVEMENTS.map((a) => {
            const done = got.has(a.id);
            const hidden = a.secret && !done;
            return (
              <li key={a.id} className={`${done ? 'is-done' : ''}${a.secret ? ' is-legendary' : ''}`}>
                <span className="award-icon">{hidden ? <PiQuestionBold /> : done ? ICONS[a.id] : <PiLockSimpleFill />}</span>
                <div>
                  <strong className={a.secret && done ? 'legendary-text' : undefined}>{hidden ? '???' : a.name}</strong>
                  <p>{hidden ? 'A secret. Something legendary, perhaps.' : a.desc}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
