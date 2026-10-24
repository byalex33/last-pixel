// Achievements are kept across campaigns; see storage.ts for how they are saved.

export type AchievementId =
  | 'first_blood' | 'giant_slayer'
  | 'clear_gate' | 'clear_coil' | 'clear_rift' | 'clear_hollow' | 'clear_core'
  | 'flawless' | 'by_a_thread'
  | 'maxed' | 'arsenal' | 'hoarder' | 'perked_up' | 'road_works' | 'not_so_fast'
  | 'thousand_cuts' | 'endless_40' | 'legendary';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  desc: string;
  secret?: boolean; // shown as ??? until unlocked
}

export const KILLS_GOAL = 1000;
export const ENDLESS_GOAL = 40;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'First Blood', desc: 'Destroy your first foe.' },
  { id: 'clear_gate', name: 'Gatekeeper', desc: 'Clear round 1, The Gate.' },
  { id: 'clear_coil', name: 'Uncoiled', desc: 'Clear round 2, The Coil.' },
  { id: 'clear_rift', name: 'Rift Sealed', desc: 'Clear round 3, The Rift.' },
  { id: 'clear_hollow', name: 'Nothing Stays Broken', desc: 'Clear round 4, The Hollow.' },
  { id: 'clear_core', name: 'The Last Pixel', desc: 'Clear round 5 and destroy the Eraser.' },
  { id: 'giant_slayer', name: 'Giant Slayer', desc: 'Destroy a Colossus.' },
  { id: 'flawless', name: 'Flawless', desc: 'Clear a round without losing a single life.' },
  { id: 'by_a_thread', name: 'By a Thread', desc: 'Clear a round with exactly 1 life left.' },
  { id: 'maxed', name: 'Maxed Out', desc: 'Upgrade a tower to level 3.' },
  { id: 'arsenal', name: 'Arsenal', desc: 'Have 12 towers on the field at once.' },
  { id: 'hoarder', name: 'Hoarder', desc: 'Hold 2,000 gold at once.' },
  { id: 'perked_up', name: 'Perked Up', desc: 'Own 3 perks at once.' },
  { id: 'road_works', name: 'Road Works', desc: 'Put down 10 placeables in one round.' },
  { id: 'not_so_fast', name: 'Not So Fast', desc: 'Stop a Glitch blinking with a Warden.' },
  { id: 'thousand_cuts', name: 'Death by a Thousand Cuts', desc: `Destroy ${KILLS_GOAL.toLocaleString('en')} foes in total.` },
  { id: 'endless_40', name: 'Endless', desc: `Reach wave ${ENDLESS_GOAL} in Endless mode.` },
  { id: 'legendary', name: 'Best Pals', desc: 'Build The James.', secret: true },
];

export const ROUND_CLEAR: Record<string, AchievementId> = {
  gate: 'clear_gate',
  coil: 'clear_coil',
  rift: 'clear_rift',
  hollow: 'clear_hollow',
  core: 'clear_core',
};
