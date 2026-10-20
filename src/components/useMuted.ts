import { useState } from 'react';
import { sfx } from '../game/audio';
import { loadMuted, saveMuted } from '../game/storage';

sfx.muted = loadMuted();

export function useMuted() {
  const [muted, setMuted] = useState(sfx.muted);
  const toggle = () => {
    sfx.muted = !sfx.muted;
    saveMuted(sfx.muted);
    setMuted(sfx.muted);
  };
  return [muted, toggle] as const;
}
