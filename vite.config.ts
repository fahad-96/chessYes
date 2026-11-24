import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Logger, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// BASE_PATH lets the same build run at a domain root or under a sub-path
// such as GitHub Pages (https://<user>.github.io/chessYes/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: {
    // The opening book (~700 kB of position data, ~100 kB gzipped) is its own lazily
    // loaded chunk; everything else stays well under Vite's default 500 kB warning.
    chunkSizeWarningLimit: 800,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
  },
});

/**
 * Finishes the service worker (public/sw.js) after a production build: replaces its
 * BUILD_ID and PRECACHE placeholders in dist/sw.js. See the header of public/sw.js.
 *
 * The build id is a hash of everything the worker serves, so identical code keeps its id
 * (no update prompt) and any change produces a new one. KIBITZ_BUILD_ID overrides it, for
 * example to pin it to a commit or to test the update prompt.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  let publicDir = '';
  let assetsDir = '';
  let logger: Logger | undefined;
  return {
    name: 'kibitz:service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
      assetsDir = config.build.assetsDir;
      logger = config.logger;
    },
    writeBundle(_options, bundle) {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;

      const files = Object.keys(bundle).sort();
      const assets = files.filter((file) => file.startsWith(`${assetsDir}/`));
      // The coach voice (public/voice-pack, ~20 MB) is never precached: the worker caches
      // each clip the first time it is played.
      const shell = ['manifest.webmanifest', 'favicon.svg', ...publicFiles(publicDir, 'icons')];
      const engine = engineFiles(publicDir);
      const servedFiles = [...shell, ...engine].filter((file) => existsSync(join(outDir, file)));

      const hash = createHash('sha256');
      for (const file of files) {
        const output = bundle[file]!;
        hash.update(file).update(output.type === 'chunk' ? output.code : output.source);
      }
      for (const file of servedFiles) hash.update(file).update(readFileSync(join(outDir, file)));
      const template = readFileSync(swPath, 'utf8');
      hash.update(template);
      const buildId = process.env.KIBITZ_BUILD_ID || hash.digest('hex').slice(0, 12);

      const precache = {
        shell: ['./', ...servedFiles.filter((file) => shell.includes(file))],
        assets,
        engine: servedFiles.filter((file) => engine.includes(file)),
      };
      const placeholders: [RegExp, string][] = [
        [/'__KIBITZ_BUILD_ID__'/, JSON.stringify(buildId)],
        [/\/\* __KIBITZ_PRECACHE__ \*\/[^;]*/, JSON.stringify(precache)],
      ];
      let sw = template;
      for (const [pattern, value] of placeholders) {
        if (!pattern.test(sw)) throw new Error(`[kibitz:service-worker] ${pattern} not in sw.js`);
        sw = sw.replace(pattern, () => value);
      }
      writeFileSync(swPath, sw);
      logger?.info(`sw.js: build ${buildId}, ${assets.length} assets precached`);
    },
  };
}

/** Files directly inside public/<dir>, as paths relative to the site root. */
function publicFiles(publicDir: string, dir: string): string[] {
  const path = join(publicDir, dir);
  if (!publicDir || !existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

/** The Stockfish script and its wasm, named by public/engine/engine.json (copy-engine.mjs). */
function engineFiles(publicDir: string): string[] {
  const manifest = join(publicDir, 'engine', 'engine.json');
  if (!publicDir || !existsSync(manifest)) return [];
  const { file } = JSON.parse(readFileSync(manifest, 'utf8')) as { file: string };
  return [`engine/${file}`, `engine/${file.replace(/\.js$/, '.wasm')}`];
}
