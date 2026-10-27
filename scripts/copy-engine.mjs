// Copies the Stockfish WASM engine from node_modules into public/engine so Vite
// serves it as a static file. The engine runs in a Web Worker on the user's device.
//
// Stockfish is GPL-3.0. We ship its license next to the binary and link to the
// exact source in the About page, which keeps the distribution compliant.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'stockfish');
const outDir = join(root, 'public', 'engine');

const FLAVOR = 'stockfish-19-lite-single';

if (!existsSync(pkgDir)) {
  console.warn('[copy-engine] node_modules/stockfish not found yet; skipping.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
for (const ext of ['js', 'wasm']) {
  copyFileSync(join(pkgDir, 'bin', `${FLAVOR}.${ext}`), join(outDir, `${FLAVOR}.${ext}`));
}
copyFileSync(join(pkgDir, 'Copying.txt'), join(outDir, 'STOCKFISH-LICENSE.txt'));

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
writeFileSync(
  join(outDir, 'engine.json'),
  JSON.stringify(
    {
      file: `${FLAVOR}.js`,
      version,
      license: 'GPL-3.0',
      source: `https://github.com/nmrugg/stockfish.js/tree/v${version}`,
    },
    null,
    2,
  ) + '\n',
);
console.log(`[copy-engine] ${FLAVOR} (stockfish.js ${version}) -> public/engine`);
