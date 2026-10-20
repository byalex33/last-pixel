// The story of Last Pixel, told one round at a time.

export interface Chapter {
  intro: string[]; // shown before the first wave of the round
  outro: string; // shown when the round is cleared
}

export const LORE: Record<string, Chapter> = {
  gate: {
    intro: [
      'Everything was drawn in colour once. Then the Static came, a grey tide that erases whatever it touches.',
      'One pixel of red survived. It burns inside the Portal, and while it burns, the world can still be redrawn.',
      'You are its Keeper. The Static has sent its scouts down the road. Hold the gate.',
    ],
    outro: 'The gate holds. The Static pulls back, and the road behind it begins to twist.',
  },
  coil: {
    intro: [
      'The scouts are gone, but the Static learns. It has bent the road into a coil to wear you down.',
      'New schematics recovered: Flamer, Minelayer and Harvester. Fire still burns in a grey world.',
    ],
    outro: 'The coil comes undone. Somewhere ahead, the world cracks open.',
  },
  rift: {
    intro: [
      'Here the world has split. The Static pours through the Rift faster than anywhere else.',
      'Your last schematics are ready: Beacon, Lancer and Quake. Use everything you have.',
    ],
    outro: 'The Rift is sealed, for now. Beneath it, something is stitching itself back together.',
  },
  hollow: {
    intro: [
      'Below the Rift the ground is already grey. Nothing here stays broken for long.',
      'Menders walk with the horde, knitting torn Static whole again. Kill them first, or fight every foe twice.',
    ],
    outro: 'The Hollow goes quiet. Only one road is left, and it leads to the Core.',
  },
  core: {
    intro: [
      'This is the heart of the Portal, the last place with any colour left.',
      'Glitches skip through your lines, and behind them comes what the Static saved for last: the Eraser. Every tower it passes goes silent.',
      'If the Core falls, there is nothing left to draw. Hold.',
    ],
    outro: 'The Eraser comes apart pixel by pixel.',
  },
};

export const EPILOGUE = [
  'Where the Eraser fell, a little colour bleeds back into the ground. Then a little more.',
  'The Last Pixel burns on, and so does everything it can redraw.',
];
