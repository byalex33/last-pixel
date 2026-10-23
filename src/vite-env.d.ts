/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Where the leaderboard API lives when the game is hosted somewhere else, like itch.io.
  readonly VITE_API_BASE?: string;
}
