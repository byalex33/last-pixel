import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  PiArrowCounterClockwiseBold, PiArrowFatUpFill, PiArrowRightBold, PiBookOpenTextFill, PiCoinsFill, PiCrosshairFill,
  PiFastForwardFill, PiFlagFill, PiHeartFill, PiInfinityBold, PiMapTrifoldFill, PiPauseFill, PiPlayFill,
  PiLockSimpleFill, PiRepeatBold, PiSkullFill, PiSpeakerHighFill, PiSpeakerSlashFill, PiTrophyFill, PiXBold,
} from 'react-icons/pi';
import { H, W } from '../game/constants';
import { Game, type Tower } from '../game/engine';
import type { MapDef } from '../game/maps';
import { EPILOGUE, LORE } from '../game/lore';
import { loadStorySeen, saveStorySeen, type Snapshot } from '../game/storage';
import {
  ENEMIES, TARGET_MODES, TOTAL_WAVES, TOWERS, TOWER_KEYS, TOWER_ORDER, type TowerLevel, type TowerType,
} from '../game/data';
import { enemyIcon, towerIcon } from '../game/sprites';
import { Btn } from './Btn';
import { EnemyCard } from './EnemyCard';
import { Story } from './Story';
import { useMuted } from './useMuted';

interface Props {
  map: MapDef;
  snapshot?: Snapshot;
  // While true the game is not attached: no ticking, input or intro banner.
  paused?: boolean;
  onRestart: () => void;
  onNextRound: () => void;
  onNewCampaign: () => void;
}

export function GameView({ map, snapshot, paused, onRestart, onNextRound, onNewCampaign }: Props) {
  // One Game per mount; App remounts via key to start a new round.
  const [game] = useState(() => new Game(map, snapshot));
  useSyncExternalStore(game.subscribe, () => game.version);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);
  const [muted, toggleMute] = useMuted();
  // Each round's story opens once, before its first wave.
  const [story, setStory] = useState(() => game.wave === 0 && loadStorySeen() < game.round);
  const chapter = LORE[map.id];
  const closeStory = () => {
    setStory(false);
    if (loadStorySeen() < game.round) saveStorySeen(game.round);
  };

  useEffect(() => {
    if (paused) return;
    game.attach(canvasRef.current!);
    window.scrollTo(0, 0);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
    return () => game.detach();
  }, [game, paused]);

  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      let s = Math.min(r.width / W, r.height / H);
      if (s >= 1) s = Math.floor(s);
      setScale(Math.max(0.5, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = game.selected;

  return (
    <div className="game">
      <header className="hud">
        <div className="hud-stats">
          <span className="stat round" title={map.blurb}>
            <PiMapTrifoldFill /> R{game.round + 1}
            <small>{map.name}</small>
          </span>
          <span className={`stat${game.lives / game.maxLives < 0.34 ? ' danger' : ''}`} title="Portal integrity">
            <PiHeartFill className="red" /> {game.lives}
          </span>
          <span className="stat" title="Gold">
            <PiCoinsFill /> {game.gold}
          </span>
          <span className="stat" title="Wave">
            <PiFlagFill /> {game.wave}
            <small>/{game.endless ? <PiInfinityBold /> : TOTAL_WAVES}</small>
          </span>
          <span className="stat dim" title="Kills">
            <PiSkullFill /> {game.kills}
          </span>
        </div>
        <div className="hud-actions">
          <Btn variant="primary" onClick={() => game.sendWave()} disabled={game.waveActive || game.status !== 'playing'}>
            <PiPlayFill />
            {game.waveActive ? `${game.remaining()} left` : game.wave === 0 ? 'Start' : 'Next wave'}
          </Btn>
          <Btn onClick={() => game.togglePause()} aria-label={game.paused ? 'Resume' : 'Pause'} active={game.paused}>
            {game.paused ? <PiPlayFill /> : <PiPauseFill />}
          </Btn>
          <Btn onClick={() => game.cycleSpeed()} aria-label="Game speed" active={game.speed > 1}>
            <PiFastForwardFill /> {game.speed}x
          </Btn>
          <Btn onClick={() => game.toggleAuto()} active={game.autoWave} title="Automatically send waves">
            <PiRepeatBold /> Auto
          </Btn>
          {chapter && (
            <Btn onClick={() => setStory(true)} aria-label="Story" title="Story">
              <PiBookOpenTextFill />
            </Btn>
          )}
          <Btn onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <PiSpeakerSlashFill /> : <PiSpeakerHighFill />}
          </Btn>
          <Btn onClick={() => {
            if(!game.paused) game.togglePause();
            onRestart()
          }} aria-label="Restart round" title="Restart round">
            <PiArrowCounterClockwiseBold />
          </Btn>
        </div>
      </header>

      <div className="game-main">
        <div className="stage" ref={stageRef}>
          <div className="screen-wrap" style={{ width: W * scale, height: H * scale }}>
            <canvas ref={canvasRef} className="screen pixel" style={{ width: W * scale, height: H * scale }} />
            <EnemyCard game={game} scale={scale} />

            {game.banner && (
              <div key={game.banner.id} className={`banner${game.banner.danger ? ' danger' : ''}`}>
                <div className="banner-text">{game.banner.text}</div>
                {game.banner.sub && <div className="banner-sub">{game.banner.sub}</div>}
              </div>
            )}

            {/* Wait for the loader to clear so the typing is seen and keys still reach the loader. */}
            {story && chapter && !paused && (
              <Story round={game.round} name={map.name} lines={chapter.intro} onClose={closeStory} />
            )}

            {!story && game.paused && game.status === 'playing' && (
              <div className="overlay">
                <div className="modal px-box">
                  <h2>Paused</h2>
                  <div className="modal-actions">
                    <Btn variant="primary" onClick={() => game.togglePause()}><PiPlayFill /> Resume</Btn>
                    <Btn onClick={onRestart}><PiArrowCounterClockwiseBold /> Restart round</Btn>
                    {game.endless && game.hasNextRound && (
                      <Btn onClick={onNextRound}><PiArrowRightBold /> Next round</Btn>
                    )}
                  </div>
                </div>
              </div>
            )}

            {game.status === 'lost' && (
              <div className="overlay">
                <div className="modal px-box">
                  <PiSkullFill className="modal-icon red" />
                  <h2>The portal has fallen</h2>
                  <p>You held out for {Math.max(0, game.wave - 1)} waves and destroyed {game.kills} foes.</p>
                  <div className="modal-actions">
                    {game.endless ? (
                      game.hasNextRound ? (
                        <Btn variant="primary" onClick={onNextRound}><PiArrowRightBold /> Round {game.round + 2}</Btn>
                      ) : (
                        <Btn variant="primary" onClick={onNewCampaign}><PiArrowCounterClockwiseBold /> New campaign</Btn>
                      )
                    ) : (
                      <Btn variant="primary" onClick={onRestart}><PiArrowCounterClockwiseBold /> Retry round</Btn>
                    )}
                  </div>
                </div>
              </div>
            )}

            {game.status === 'won' && (
              <div className="overlay">
                <div className="modal px-box">
                  <PiTrophyFill className="modal-icon" />
                  <h2>{game.hasNextRound ? `Round ${game.round + 1} cleared` : 'The Last Pixel burns on'}</h2>
                  {chapter && <p className="story-line">{chapter.outro}</p>}
                  {!game.hasNextRound && EPILOGUE.map((line) => <p key={line} className="story-line">{line}</p>)}
                  <p>
                    All {TOTAL_WAVES} waves repelled, with {game.lives} of {game.maxLives} lives left.
                    {!game.hasNextRound && ' Every round is beaten.'}
                  </p>
                  {game.hasNextRound && <UnlockList round={game.round + 1} />}
                  <div className="modal-actions">
                    {game.hasNextRound ? (
                      <Btn variant="primary" onClick={onNextRound}><PiArrowRightBold /> Round {game.round + 2}</Btn>
                    ) : (
                      <Btn variant="primary" onClick={onNewCampaign}><PiArrowCounterClockwiseBold /> New campaign</Btn>
                    )}
                    <Btn onClick={() => game.continueEndless()}><PiInfinityBold /> Endless</Btn>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="side">
          <section className="panel px-box">
            <h3>Build</h3>
            <div className="shop">
              {TOWER_ORDER.map((t, i) => {
                const cost = TOWERS[t].levels[0].cost;
                const locked = !game.unlocked(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className={`shop-item${game.placing === t ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                    disabled={locked || (game.gold < cost && game.placing !== t)}
                    onClick={(e) => {
                      game.toggleBuild(t);
                      e.currentTarget.blur();
                    }}
                    title={locked ? `Unlocks in round ${TOWERS[t].unlock + 1}` : TOWERS[t].blurb}
                  >
                    <kbd>{TOWER_KEYS[i]}</kbd>
                    <img src={towerIcon(t, 1)} alt="" className="pixel icon32" />
                    <span className="shop-name">{TOWERS[t].name}</span>
                    {locked ? (
                      <span className="shop-cost"><PiLockSimpleFill /> R{TOWERS[t].unlock + 1}</span>
                    ) : (
                      <span className="shop-cost"><PiCoinsFill /> {cost}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {sel ? (
            <Inspector game={game} t={sel} />
          ) : game.placing ? (
            <PlacingInfo type={game.placing} onCancel={() => game.toggleBuild(null)} />
          ) : (
            <section className="panel px-box">
              <h3>Tip</h3>
              <p className="hint">
                Pick a tower, then click an empty tile to build it. Click a tower to upgrade or sell it.
                Hover over an enemy to see its stats. Press <kbd>Space</kbd> to send the next wave.
              </p>
            </section>
          )}

          <section className="panel px-box">
            <h3>{game.waveActive ? `Wave ${game.wave}` : `Next: wave ${game.wave + 1}`}</h3>
            <ul className="preview">
              {game.nextWavePreview().map(({ type, count }) => (
                <li key={type} title={`${ENEMIES[type].name}: ${ENEMIES[type].trait}`}>
                  <span className="enemy-frame">
                    <img src={enemyIcon(type)} alt={ENEMIES[type].name} className="pixel" />
                  </span>
                  <span>x{count}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const tiles = (n: number) => (n / 16).toFixed(1);
const pct = (n: number) => `${Math.round(n * 100)}%`;

function statRows(L: TowerLevel, next?: TowerLevel) {
  const fmt = (a: number, b: number | undefined, f: (n: number) => string) =>
    b !== undefined && f(b) !== f(a) ? (
      <>
        {f(a)} <span className="up">{f(b)}</span>
      </>
    ) : (
      f(a)
    );
  const rows: [string, ReactNode][] = [];
  const add = (label: string, key: keyof TowerLevel, f: (n: number) => string) => {
    const a = L[key];
    if (a) rows.push([label, fmt(a, next?.[key], f)]);
  };
  add('Damage', 'dmg', num);
  add(L.buff ? 'Aura' : L.bounty ? 'Reach' : 'Range', 'range', tiles);
  if (L.rate) rows.push([L.mines ? 'Lays' : 'Rate', fmt(1 / L.rate, next ? 1 / next.rate : undefined, (n) => `${n.toFixed(1)}/s`)]);
  add('Blast', 'splash', tiles);
  add('Slow', 'slow', pct);
  add('Chains', 'chains', num);
  add('Burn', 'burn', (n) => `${num(n)}/s`);
  add('Max heat', 'ramp', (n) => `x${num(n)}`);
  add('Mines', 'mines', num);
  add('Knock', 'knock', tiles);
  add('Stun', 'stun', (n) => `${num(n)}s`);
  add('Boost', 'buff', (n) => `+${pct(n)}`);
  add('Per wave', 'income', (n) => `+${n}`);
  add('Bounty', 'bounty', (n) => `+${pct(n)}`);
  return rows;
}

function UnlockList({ round }: { round: number }) {
  const fresh = TOWER_ORDER.filter((t) => TOWERS[t].unlock === round);
  if (!fresh.length) return null;
  return (
    <div className="unlocks">
      <span className="unlocks-label">Unlocks next round</span>
      <ul>
        {fresh.map((t) => (
          <li key={t} title={TOWERS[t].blurb}>
            <img src={towerIcon(t, 1)} alt="" className="pixel icon32" />
            <span>{TOWERS[t].name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Inspector({ game, t }: { game: Game; t: Tower }) {
  const def = TOWERS[t.type];
  const L = def.levels[t.level - 1];
  const next = def.levels[t.level];
  return (
    <section className="panel px-box inspector">
      <div className="insp-head">
        <img src={towerIcon(t.type, t.level)} alt="" className="pixel icon48" />
        <div>
          <h3>{def.name}</h3>
          <div className="pips">
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= t.level ? 'on' : ''} />
            ))}
          </div>
        </div>
        <Btn variant="ghost" className="insp-close" onClick={() => game.select(null)} aria-label="Deselect">
          <PiXBold />
        </Btn>
      </div>
      <dl className="stats">
        {statRows(L, next).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {game.buffOf(t) > 0 && (
          <div>
            <dt>Beacon</dt>
            <dd className="red">+{pct(game.buffOf(t))}</dd>
          </div>
        )}
        {(def.levels[0].dmg > 0 || t.kills > 0) && (
          <div>
            <dt>Kills</dt>
            <dd>{t.kills}</dd>
          </div>
        )}
      </dl>
      {def.aims && (
        <div className="modes" role="radiogroup" aria-label="Targeting">
          <PiCrosshairFill className="dim" />
          {TARGET_MODES.map((m) => (
            <Btn key={m} variant="ghost" active={t.mode === m} onClick={() => game.setMode(m)}>
              {m}
            </Btn>
          ))}
        </div>
      )}
      <div className="insp-actions">
        {next ? (
          <Btn variant="primary" disabled={game.gold < next.cost} onClick={() => game.upgradeSelected()}>
            <PiArrowFatUpFill /> Upgrade <PiCoinsFill /> {next.cost}
          </Btn>
        ) : (
          <Btn disabled>Max level</Btn>
        )}
        <Btn onClick={() => game.sellSelected()}>
          Sell <PiCoinsFill /> {game.sellValue(t)}
        </Btn>
      </div>
    </section>
  );
}

function PlacingInfo({ type, onCancel }: { type: TowerType; onCancel: () => void }) {
  const def = TOWERS[type];
  return (
    <section className="panel px-box inspector">
      <div className="insp-head">
        <img src={towerIcon(type, 1)} alt="" className="pixel icon48" />
        <div>
          <h3>{def.name}</h3>
          <p className="hint">{def.blurb}</p>
        </div>
        <Btn variant="ghost" className="insp-close" onClick={onCancel} aria-label="Cancel">
          <PiXBold />
        </Btn>
      </div>
      <dl className="stats">
        {statRows(def.levels[0]).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">Click an empty tile to build. Hold <kbd>Shift</kbd> to build several.</p>
    </section>
  );
}
