import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the standalone trailer page (trailer.html) into dist-trailer/.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-trailer',
    emptyOutDir: true,
    rollupOptions: { input: 'trailer.html' },
  },
});
