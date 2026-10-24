import { useState } from 'react';
import { GameView } from './components/GameView';
import { Loader } from './components/Loader';
import { MAPS } from './game/maps';
import { loadProgress, saveProgress, saveStorySeen, type Progress } from './game/storage';

type Run = Progress & { run: number };

function clampRound(round: number) {
  return Math.min(Math.max(0, Math.floor(round)), MAPS.length - 1);
}

function subtitle({ round, snapshot }: Progress) {
  const head = `Round ${round + 1} - ${MAPS[round].name}`;
  return snapshot?.wave ? `${head} - Wave ${snapshot.wave + 1}` : head;
}

export function App() {
  const [run, setRun] = useState<Run>(() => {
    const p = loadProgress();
    return { ...p, round: clampRound(p.round), run: 0 };
  });
  const [phase, setPhase] = useState<'loading' | 'revealing' | 'done'>('loading');

  // Starts a round afresh. The furthest round reached is kept, even by New campaign;
  // carried perks are kept too, unless perks says otherwise.
  const startRound = (round: number, perks?: string[]) => {
    setRun({ ...saveProgress({ round: clampRound(round), perks }), run: Date.now() });
  };

  return (
    <>
      <GameView
        key={run.run}
        map={MAPS[run.round]}
        snapshot={run.snapshot}
        paused={phase === 'loading'}
        onRestart={(perks) => startRound(run.round, perks)}
        onNextRound={(perks) => startRound(run.round + 1, perks)}
        onNewCampaign={() => {
          saveStorySeen(-1);
          startRound(0, []);
        }}
      />
      {phase !== 'done' && (
        <Loader
          subtitle={subtitle(run)}
          onReveal={() => setPhase('revealing')}
          onDone={() => setPhase('done')}
        />
      )}
    </>
  );
}
