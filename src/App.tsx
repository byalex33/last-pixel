import { useState } from 'react';
import { GameView } from './components/GameView';
import { Loader } from './components/Loader';
import { MAPS } from './game/maps';
import { loadProgress, saveProgress, saveStorySeen, type Progress } from './game/storage';
import Modal from './components/Modal';
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
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'revealing' | 'done'>('loading');

  const startRound = (round: number) => {
    const r = clampRound(round);
    saveProgress({ round: r });
    setRun({ round: r, run: Date.now() });
  };

  return (
    <>
      <GameView
        key={run.run}
        map={MAPS[run.round]}
        snapshot={run.snapshot}
        paused={phase === 'loading'}
        onRestart={() => setIsRestartModalOpen(true)}
        onNextRound={() => startRound(run.round + 1)}
        onNewCampaign={() => {
          saveStorySeen(-1);
          startRound(0);
        }}
      />
      {isRestartModalOpen && (
        <Modal text="Reset the game" onAccept={() => {
            setIsRestartModalOpen(false);
            startRound(run.round)
          }
        } onDecline={() => setIsRestartModalOpen(false)} />
      )}
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
