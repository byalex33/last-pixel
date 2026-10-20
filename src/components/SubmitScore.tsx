import { useState, type FormEvent } from 'react';
import { PiRankingFill } from 'react-icons/pi';
import type { Game } from '../game/engine';
import { loadHandle, saveHandle } from '../game/storage';
import { submitRun, type SubmitResult } from '../net/api';
import { Btn } from './Btn';

type State =
  | { k: 'idle' }
  | { k: 'sending' }
  | { k: 'done'; r: SubmitResult; handle: string }
  | { k: 'error'; msg: string };

// Shown when a run ends: sends the run's log to be verified and ranked.
export function SubmitScore({ game, onShowBoard }: { game: Game; onShowBoard: (handle?: string) => void }) {
  const [handle, setHandle] = useState(loadHandle);
  const [state, setState] = useState<State>({ k: 'idle' });

  if (!game.runId) return game.unranked ? <p className="hint submit-note">{game.unranked}</p> : null;
  if (game.cleared < 1) return <p className="hint submit-note">Clear a wave to get on the leaderboard.</p>;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) {
      setState({ k: 'error', msg: 'Enter your X handle: up to 15 letters, numbers or underscores.' });
      return;
    }
    saveHandle(h);
    setState({ k: 'sending' });
    try {
      const r = await submitRun({
        id: game.runId!, handle: h, log: game.log, endTick: game.tick,
        claim: { wave: game.cleared, kills: game.kills },
      });
      setState({ k: 'done', r, handle: h });
    } catch (err) {
      setState({ k: 'error', msg: (err as Error).message });
    }
  };

  if (state.k === 'done') {
    const { r } = state;
    return (
      <div className="submit">
        <span className="submit-label"><PiRankingFill /> Leaderboard</span>
        <p className="submit-result">
          Verified: {r.wave} {r.wave === 1 ? 'wave' : 'waves'}, {r.kills} kills.{' '}
          {r.improved
            ? r.rank && <>You’re <strong>#{r.rank}</strong> on {game.map.name}.</>
            : r.best && <>Your best here is still {r.best.wave} waves{r.rank ? `, #${r.rank}` : ''}.</>}
        </p>
        <Btn onClick={() => onShowBoard(state.handle)}><PiRankingFill /> View leaderboard</Btn>
      </div>
    );
  }

  return (
    <form className="submit" onSubmit={send}>
      <label className="submit-label" htmlFor="handle"><PiRankingFill /> Put this run on the leaderboard</label>
      <div className="submit-form">
        <span className="handle-field">
          <span aria-hidden>@</span>
          <input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="your X handle"
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            disabled={state.k === 'sending'}
          />
        </span>
        <Btn type="submit" variant="primary" disabled={state.k === 'sending' || !handle.trim()}>
          {state.k === 'sending' ? 'Verifying...' : 'Submit'}
        </Btn>
      </div>
      {state.k === 'error' && <p className="submit-error" role="alert">{state.msg}</p>}
    </form>
  );
}
