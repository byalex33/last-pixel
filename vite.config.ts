import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the build also runs from a subfolder (itch.io serves games from one).
  base: './',
  plugins: [react()],
});
