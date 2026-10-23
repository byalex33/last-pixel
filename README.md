<div align="center">

<img src="docs/screenshots/banner.png" alt="Last Pixel" width="100%" />

### A monochrome pixel-art tower defense game for the browser.

The world has gone grey. One red pixel is left. Hold the line.

[![Play now](https://img.shields.io/badge/PLAY_NOW-lastpixel.alex.codes-d11d32?style=for-the-badge&labelColor=080808)](https://lastpixel.alex.codes)

![React](https://img.shields.io/badge/React_18-131313?style=flat-square&logo=react&logoColor=f4f4f4)
![TypeScript](https://img.shields.io/badge/TypeScript-131313?style=flat-square&logo=typescript&logoColor=f4f4f4)
![Vite](https://img.shields.io/badge/Vite-131313?style=flat-square&logo=vite&logoColor=f4f4f4)
![Canvas](https://img.shields.io/badge/Canvas_2D-131313?style=flat-square&logo=html5&logoColor=f4f4f4)
![Web Audio](https://img.shields.io/badge/Web_Audio-131313?style=flat-square&logo=audiomack&logoColor=f4f4f4)
[![MIT License](https://img.shields.io/badge/license-MIT-d11d32?style=flat-square&labelColor=131313)](LICENSE)

</div>

<br />

<p align="center">
  <img src="docs/screenshots/gameplay.png" alt="Defending The Rift with a full line of towers" width="100%" />
</p>

## The story

Everything was drawn in colour once. Then the **Static** came, a grey tide that erases whatever it touches. One pixel of red survived inside the Portal, and while it burns, the world can still be redrawn.

You are its Keeper. Over five rounds, the Static pushes deeper with new tricks. It sends Menders that stitch the horde back together, Glitches that skip through your lines and, at the very end, **the Eraser**.

## Features

- **5 handcrafted rounds** with a story campaign, from The Gate down to The Core, each harder than the last
- **11 towers**, each with 3 upgrade levels and its own job: chain lightning, armor-piercing fire, knockback, mines, buff auras and economy
- **10 enemy types**, with armor, splitting, slow immunity, healing, blinking and two bosses
- **Targeting modes** (first, last, strongest, closest) per tower
- **Endless mode** once you clear wave 30
- **Verified leaderboard.** Put your X handle on a per-map leaderboard with no sign-up. Every score is verified by replaying your whole run on the server
- **Autosave** between waves, so you can close the tab and pick up where you left off
- **Speed controls and auto-wave** for when you know your build works
- **Zero image or audio files.** Every sprite is drawn in code on a strict 12-colour palette, and every sound effect and track is synthesised live with the Web Audio API
- **Plays on desktop and mobile**, with full keyboard shortcuts on desktop
- **Built-in trailer** that renders itself from the game engine and can export to video

<p align="center">
  <img src="docs/screenshots/core.png" alt="The Core, the final round" width="100%" />
</p>

## Towers

| Key | Tower | Role | Unlocks |
| :-: | --- | --- | :-: |
| `1` | **Blaster** | Rapid single-target shots. Weak against armor. | Round 1 |
| `2` | **Mortar** | Lobs shells that damage everything in a blast radius. | Round 1 |
| `3` | **Frost** | Pulses cold that slows every foe in range. | Round 1 |
| `4` | **Railgun** | Long-range beam that pierces every foe in a line. | Round 1 |
| `5` | **Tesla** | Lightning that arcs between nearby foes. | Round 1 |
| `6` | **Flamer** | Short cone of fire. Burning ignores armor. | Round 2 |
| `7` | **Minelayer** | Seeds the nearby road with mines that blow on contact. | Round 2 |
| `8` | **Harvester** | No attack. Pays gold each wave and boosts kill gold nearby. | Round 2 |
| `9` | **Beacon** | No attack. Boosts damage and fire rate of towers around it. | Round 3 |
| `0` | **Lancer** | Steady laser that heats up the longer it holds a target. | Round 3 |
| `-` | **Quake** | Slams the ground, knocking foes back and stunning them. | Round 3 |

## The horde

| Enemy | Trait |
| --- | --- |
| **Crawler** | The bulk of the horde. Slow and steady. |
| **Runner** | Fast and fragile. Dies to almost anything. |
| **Brute** | A slow wall of flesh that soaks up damage. |
| **Husk** | A plated shell that shrugs off small hits. |
| **Splitter** | Bursts into three Runners when killed. |
| **Wisp** | A flickering spirit that cold cannot touch. |
| **Mender** | Heals the horde around it. Kill it first. |
| **Glitch** | Skips frames, blinking forward through your lines. |
| **Colossus** | Boss. Arrives every 10 waves. |
| **The Eraser** | Final boss. Every tower it passes goes silent. |

## Controls

| Input | Action |
| --- | --- |
| `1` to `0`, `-` | Pick a tower to build |
| Click a tile | Build the picked tower (hold `Shift` to keep building) |
| Click a tower | Select it to upgrade, sell or change targeting |
| `Space` | Send the next wave |
| `U` | Upgrade the selected tower |
| `S` / `Delete` | Sell the selected tower |
| `T` | Cycle targeting mode |
| `F` | Cycle game speed (1x, 2x, 3x) |
| `P` | Pause |
| `Esc` | Cancel / deselect |

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/byalex33/last-pixel.git
cd last-pixel
npm install
npm run dev
```

Then open http://localhost:5173. The leaderboard works locally too: the dev server runs the API with an in-memory store.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check and build the game into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run the TypeScript compiler without emitting |
| `npm test` | Run the tests, including replays that check runs are fully deterministic |
| `npm run build:itch` | Build the itch.io version and zip it as `dist-itch/last-pixel-itch.zip` |
| `npm run build:trailer` | Build the standalone trailer page into `dist-trailer/` |

The trailer is also available in dev at http://localhost:5173/trailer.html.

## How it's built

There is no game framework. The whole thing is React for the UI shell and a hand-rolled engine drawing to a single `<canvas>`.

```
src/
  game/
    sim.ts         The rules: fixed-step simulation, targeting, projectiles, waves. No DOM, runs on the server too
    engine.ts      The playable game on top of sim.ts: rendering, input, effects, sound, saves
    rng.ts         Seeded random numbers for everything that affects a run
    detmath.ts     sin, cos, atan2 and distance that give identical results in every JS engine
    data.ts        Tower and enemy stats, waves, unlocks
    maps.ts        The five maps, defined as tile waypoints
    sprites.ts     Every sprite, drawn procedurally onto offscreen canvases
    audio.ts       Synthesised sound effects and music (Web Audio API)
    lore.ts        The story, one chapter per round
    storage.ts     Autosave, best waves and settings in localStorage
  components/      React UI: HUD, build panel, inspector, story, loader, leaderboard
  net/             Leaderboard API client
  trailer/         Self-directing trailer built on the real engine, with video export
server/            Leaderboard API: run tickets, replay verification, rankings, storage
api/               Vercel Functions, thin wrappers around server/
tests/             Determinism and API tests
```

The game runs on a 320 x 192 logical canvas (20 x 12 tiles of 16px), updated at a fixed 60 steps per second and scaled up with crisp pixels. The palette is eight greys and four reds, nothing else.

## The leaderboard

There are no accounts. When a run ends you type your X handle and submit, and the score lands on that map's leaderboard. Only your best run per map is kept, ranked by waves cleared and then by kills.

### How scores are verified

The game never tells the server its score. Instead:

1. **A run starts.** The browser asks `POST /api/run` for a ticket. The server makes a run id and a random seed and keeps them for 30 days.
2. **You play.** All randomness that affects the game comes from that seed, and the simulation advances in fixed 1/60 s steps. Every command you give (build, upgrade, sell, retarget, send wave, Auto, Endless) is recorded with the step it happened on. A full round is a few KB.
3. **The run ends.** The browser uploads the command log to `POST /api/submit`.
4. **The server replays it.** It runs the exact same `sim.ts` with the stored seed and feeds in your commands. Whatever the replay produces is your score. A log that tries to do something impossible, like spending gold you never had, is rejected.

Editing your gold in the console, typing in a score or calling the API by hand gets you nowhere, because only a run that actually plays out can score. The simulation sticks to arithmetic that gives the same answer in every browser and in Node, and the tests replay full runs on every map to check that live and replayed results match exactly.

This doesn't stop someone writing a bot that genuinely plays the game, and it doesn't verify that a handle belongs to whoever typed it. The leaderboard says so.

If you change anything that affects how a run plays out, bump `SIM_VERSION` in `src/game/sim.ts`. Runs recorded on an older version can't be replayed against new rules, so they are refused instead of being scored wrongly.

### Hosting your own

The API runs as Vercel Functions in `api/` and stores data in Redis through [Upstash](https://upstash.com):

1. In the Vercel project, open **Storage**, add **Upstash for Redis** (the free plan is plenty) and connect it to the project. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. Redeploy.

Optional environment variables:

| Variable | What it does |
| --- | --- |
| `ADMIN_TOKEN` | Enables `DELETE /api/admin?handle=name&map=gate` (with `Authorization: Bearer <token>`) for removing entries. Leave out `map` to remove a handle from every board. |
| `HANDLE_BLOCKLIST` | Comma-separated words that may not appear in handles. |

Without Redis credentials, a deployed site reports the leaderboard as unavailable and the game plays on as normal, with runs marked unranked.

### On itch.io

The itch.io build plays on the same leaderboard as the website. It calls the API on lastpixel.alex.codes, which allows requests from other origins.

1. Run `npm run build:itch`. To point a fork at its own deployment, set `VITE_API_BASE=https://your-site.example` first.
2. On itch.io, create an **HTML** project and upload `dist-itch/last-pixel-itch.zip` with **This file will be played in the browser** ticked.
3. Under **Embed options**, set the viewport to about 1280 x 800, enable the fullscreen button and tick **Mobile friendly**.

Saves on itch.io are kept separately from saves on the website, since they live on a different domain.

## Contributing

Issues and pull requests are welcome. If you want to add a tower, enemy or map, most of it lives in `src/game/data.ts` and `src/game/maps.ts`. Please run `npm run typecheck` and `npm test` before opening a PR.

## License

[MIT](LICENSE). Do what you like with it.
