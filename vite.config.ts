import { devvit } from '@devvit/start/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

/**
 * Unified Vite config powered by `@devvit/start/vite`.
 *
 * The `devvit()` plugin uses Vite's Environment API to build the client
 * (React iframe webview) and server (Devvit Web HTTP handlers) in one pass.
 * Output goes to `dist/client/` and `dist/server/index.cjs` — those paths
 * must match `post.dir` and `server.{dir,entry}` in `devvit.json`.
 *
 * This is the pattern used by Reddit's official devvit-template-react.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devvit(),
    // Bundle composition report — open dist/client/stats.html after build to
    // visualise what's in the bundle. Only emitted in non-CI builds.
    visualizer({
      filename: 'dist/client/stats.html',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
});
