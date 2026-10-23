import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serves the leaderboard API (api/*.ts on Vercel) from the dev server, with an in-memory store
// unless Upstash credentials are set, so `npm run dev` runs the whole game locally.
function devApi(): Plugin {
  return {
    name: 'last-pixel-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const { route } = (await server.ssrLoadModule('/server/handlers.ts')) as typeof import('./server/handlers');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const method = req.method ?? 'GET';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const response = await route(new Request(`http://${req.headers.host}${req.url}`, {
            method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          }));
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

// `vite build --mode itch` makes a build for itch.io: relative asset paths, because itch serves
// the game from a subfolder, and an absolute API address, because itch's domain has no API.
// Point a fork at its own deployment with VITE_API_BASE.
export default defineConfig(({ mode }) => {
  if (mode !== 'itch') return { plugins: [react(), devApi()] };
  const api = process.env.VITE_API_BASE ?? 'https://lastpixel.alex.codes';
  return {
    plugins: [react()],
    base: './',
    define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(api) },
    build: { outDir: 'dist-itch/game', emptyOutDir: true },
  };
});
