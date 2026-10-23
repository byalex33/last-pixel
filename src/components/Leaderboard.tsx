import { useEffect, useState } from 'react';
import { PiFlagFill, PiInfinityBold, PiRankingFill, PiSkullFill, PiXBold } from 'react-icons/pi';
import { MAPS } from '../game/maps';
import { fetchBoard, type Entry } from '../net/api';
import { Btn } from './Btn';

interface Props {
  initialMap: string;
  // Handle to pick out in the list, after the player submits.
  highlight?: string;
  onClose: () => void;
}

export function Leaderboard({ initialMap, highlight, onClose }: Props) {
  const [map, setMap] = useState(initialMap);
  const [data, setData] = useState<{ map: string; entries?: Entry[]; error?: string }>({ map: '' });

  useEffect(() => {
    let live = true;
    fetchBoard(map)
      .then((r) => live && setData({ map, entries: r.entries }))
      .catch((e: Error) => live && setData({ map, error: e.message }));
    return () => {
      live = false;
    };
  }, [map]);

  // While open, keys never reach the game; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const loading = data.map !== map;
  const you = highlight?.toLowerCase();

  return (
    <div
      className="overlay overlay-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-title"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal px-box board">
        <div className="board-head">
          <h2 id="board-title"><PiRankingFill /> Leaderboard</h2>
          <Btn variant="ghost" onClick={onClose} aria-label="Close"><PiXBold /></Btn>
        </div>
        <div className="board-tabs" role="tablist" aria-label="Map">
          {MAPS.map((m, i) => (
            <Btn key={m.id} variant="ghost" role="tab" aria-selected={m.id === map} active={m.id === map} onClick={() => setMap(m.id)}>
              R{i + 1} <span className="tab-name">{m.name}</span>
            </Btn>
          ))}
        </div>
        {loading ? (
          <p className="board-msg">Loading...</p>
        ) : data.error ? (
          <p className="board-msg">{data.error}</p>
        ) : !data.entries?.length ? (
          <p className="board-msg">No verified runs here yet. Be the first.</p>
        ) : (
          <ol className="board-list">
            {data.entries.map((e) => (
              <li key={e.handle} className={e.handle.toLowerCase() === you ? 'is-you' : ''}>
                <span className="board-rank">{e.rank}</span>
                <a className="board-handle" href={`https://x.com/${e.handle}`} target="_blank" rel="noopener noreferrer nofollow">
                  @{e.handle}
                </a>
                <span className="board-wave" title={e.endless ? 'Waves cleared, into Endless' : 'Waves cleared'}>
                  <PiFlagFill /> {e.wave}
                  {e.endless && <PiInfinityBold />}
                </span>
                <span className="board-kills dim" title="Kills">
                  <PiSkullFill /> {e.kills}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="hint">Every score is checked by replaying the whole run on the server. Handles are not verified.</p>
      </div>
    </div>
  );
}
