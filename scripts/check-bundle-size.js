#!/usr/bin/env node
/**
 * Bundle size guard.
 *
 * Fails the build if the initial JS chunk (default.js) exceeds the gzipped
 * size cap. Run as part of CI after `npm run build`.
 *
 * Cap rationale: Devvit webview is iframed in Reddit on mobile. Every KB
 * delays time-to-interactive for mods. 150 KB gzipped is generous headroom
 * above the current 87 KB baseline while still blocking accidental regressions
 * (e.g. someone importing recharts into a non-lazy path again).
 *
 * Only the INITIAL chunk (default.js) is checked. Lazy chunks (SentimentChart,
 * Settings) are fetched on-demand and don't affect first paint.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';

const INITIAL_CHUNK = 'dist/client/default.js';
const CAP_BYTES = 150 * 1024; // 150 KB gzipped

async function gzippedSize(filepath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const src = createReadStream(filepath);
    const gz = createGzip({ level: 9 });
    src.pipe(gz);
    gz.on('data', (chunk) => {
      size += chunk.length;
    });
    gz.on('end', () => resolve(size));
    gz.on('error', reject);
    src.on('error', reject);
  });
}

async function main() {
  // Verify the file exists (build ran successfully)
  try {
    await stat(INITIAL_CHUNK);
  } catch {
    console.error(`[bundle-size] ERROR: ${INITIAL_CHUNK} not found. Run npm run build first.`);
    process.exit(1);
  }

  const bytes = await gzippedSize(INITIAL_CHUNK);
  const kb = (bytes / 1024).toFixed(1);
  const capKb = (CAP_BYTES / 1024).toFixed(0);

  if (bytes > CAP_BYTES) {
    console.error(
      `[bundle-size] FAIL: ${INITIAL_CHUNK} is ${kb} KB gzipped (cap: ${capKb} KB).`,
    );
    console.error(
      '[bundle-size] The initial JS chunk has grown past the cap. Check that:',
    );
    console.error('[bundle-size]   1. recharts is only imported in SentimentChart.tsx (lazy)');
    console.error('[bundle-size]   2. Settings.tsx is only imported via lazy() in Dashboard.tsx');
    console.error('[bundle-size]   3. No new large dep was added to an eager import path');
    console.error('[bundle-size]   Open dist/client/stats.html for a visual breakdown.');
    process.exit(1);
  }

  console.log(`[bundle-size] OK: ${INITIAL_CHUNK} = ${kb} KB gzipped (cap: ${capKb} KB)`);
}

main();
