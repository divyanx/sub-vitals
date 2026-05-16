import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for the Devvit Web post entry.
 *
 * The Daily Pulse custom post and full dashboard are served from a single React
 * bundle inside Devvit Web's iframe. The same bundle renders different views
 * based on the URL the iframe is mounted with — `?view=pulse` for the pinned
 * post, default for the full dashboard.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(import.meta.dirname, 'src/post'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/post'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/post/index.html'),
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
});
