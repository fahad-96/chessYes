// Builds src/core/openings/data/openings.json from the Lichess chess-openings dataset
// (CC0-1.0, https://github.com/lichess-org/chess-openings).
//
//   npm run openings                               download a.tsv ... e.tsv and rebuild
//   node scripts/build-openings.mjs --dir <path>   rebuild from local copies of the TSVs
//
// Every position along every dataset line is stored, keyed like positionKey() in
// src/core/notation.ts, so the app can tell how long a game stayed in book and name
// the opening even after a transposition. The output is deterministic: the same
// dataset always produces a byte-identical file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(root, 'src', 'core', 'openings', 'data', 'openings.json');
const SOURCE = 'https://github.com/lichess-org/chess-openings';
const BASE_URL = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

/** Same as positionKey() in src/core/notation.ts: placement, side to move, castling. */
function positionKey(fen) {
  return fen.split(' ').slice(0, 3).join(' ');
}

// Plain code-unit comparison: localeCompare depends on the machine's ICU data, and the
// output must not change between contributors.
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOpening(a, b) {
  return compareText(a.name, b.name) || compareText(a.eco, b.eco);
}

/** Named positions: the line with the fewest plies wins, then the alphabetically first name. */
function compareEndpoint(a, b) {
  return a.plies - b.plies || compareOpening(a, b);
}

/**
 * Inherited names for positions in the middle of lines: the deepest named ancestor wins,
 * then the alphabetically first name. `null` (no named ancestor) loses to any name.
 */
function compareInherited(a, b) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return b.depth - a.depth || compareOpening(a, b);
}

async function readTsv(file, dir) {
  if (dir) return readFileSync(join(dir, file), 'utf8');
  const response = await fetch(`${BASE_URL}/${file}`);
  if (!response.ok) throw new Error(`GET ${file}: HTTP ${response.status}`);
  return response.text();
}

function parseTsv(file, text) {
  const [header, ...rows] = text.replace(/\r\n?/g, '\n').split('\n');
  if (header !== 'eco\tname\tpgn') throw new Error(`${file}: unexpected header "${header}"`);
  return rows.flatMap((row, i) => {
    if (row.trim() === '') return [];
    const [eco, name, pgn, ...extra] = row.split('\t');
    if (!eco || !name || !pgn || extra.length > 0) {
      throw new Error(`${file}:${i + 2}: expected 3 tab-separated columns`);
    }
    return [{ eco, name, pgn, where: `${file}:${i + 2}` }];
  });
}

/** Position keys after each ply of a line; the start position is not included. */
function replay(line) {
  const chess = new Chess();
  chess.loadPgn(line.pgn);
  return chess.history({ verbose: true }).map((move) => positionKey(move.after));
}

function buildBook(lines) {
  // Pass 1: positions that end at least one dataset line carry their own name.
  const named = new Map();
  for (const line of lines) {
    const key = line.keys.at(-1);
    const candidate = { plies: line.keys.length, eco: line.eco, name: line.name };
    const current = named.get(key);
    if (!current || compareEndpoint(candidate, current) < 0) named.set(key, candidate);
  }

  // Pass 2: every other position inherits the deepest named position before it.
  const inherited = new Map();
  for (const line of lines) {
    let ancestor = null;
    line.keys.forEach((key, index) => {
      const own = named.get(key);
      if (own) {
        ancestor = { depth: index + 1, eco: own.eco, name: own.name };
        return;
      }
      const current = inherited.get(key);
      if (current === undefined || compareInherited(ancestor, current) < 0) {
        inherited.set(key, ancestor);
      }
    });
  }

  // Only names that some position points to are stored.
  const used = new Map();
  for (const opening of [...named.values(), ...inherited.values()]) {
    if (opening) used.set(`${opening.eco}\t${opening.name}`, [opening.eco, opening.name]);
  }
  const names = [...used.values()].sort(
    ([ecoA, nameA], [ecoB, nameB]) => compareText(ecoA, ecoB) || compareText(nameA, nameB),
  );
  const nameIndex = new Map(names.map(([eco, name], index) => [`${eco}\t${name}`, index]));
  const indexOf = (opening) => (opening ? nameIndex.get(`${opening.eco}\t${opening.name}`) : -1);

  const positions = {};
  const keys = [...new Set([...named.keys(), ...inherited.keys()])].sort(compareText);
  for (const key of keys) positions[key] = indexOf(named.get(key) ?? inherited.get(key));

  const stats = {
    named: named.size,
    inheritedNamed: [...inherited.values()].filter(Boolean).length,
    unnamed: [...inherited.values()].filter((opening) => !opening).length,
  };
  return { book: { source: SOURCE, license: 'CC0-1.0', names, positions }, stats };
}

async function main() {
  const dirFlag = process.argv.indexOf('--dir');
  const dir = dirFlag === -1 ? null : process.argv[dirFlag + 1];
  if (dirFlag !== -1 && !dir) throw new Error('--dir needs a path');

  const lines = [];
  const failures = [];
  for (const file of FILES) {
    // One file at a time: raw.githubusercontent.com is a shared, rate-limited host.
    for (const line of parseTsv(file, await readTsv(file, dir))) {
      try {
        const keys = replay(line);
        if (keys.length === 0) throw new Error('no moves');
        lines.push({ ...line, keys });
      } catch (error) {
        failures.push(`${line.where} ${line.name}: ${error.message}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Could not replay ${failures.length} line(s):\n  ${failures.join('\n  ')}`);
  }

  const { book, stats } = buildBook(lines);
  const json = `${JSON.stringify(book)}\n`;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, json);

  const kib = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`[openings] ${lines.length} lines from ${FILES.length} files (${SOURCE})`);
  console.log(
    `[openings] ${book.names.length} names used, ` +
      `${Object.keys(book.positions).length} positions`,
  );
  console.log(
    `[openings]   ${stats.named} named, ${stats.inheritedNamed} inherit a name, ` +
      `${stats.unnamed} before any named position`,
  );
  console.log(`[openings] wrote ${OUT_FILE} (${kib} KiB)`);
}

main().catch((error) => {
  console.error(`[openings] ${error.message}`);
  process.exit(1);
});
