// Writes the voice pack's clip list (clips.json) from src/voice/vocabulary.ts: every clip the
// coach can say, with its stable key and the exact text the speech model renders.
//
//   npm run voice:clips -- <output path>
//   npm run voice:clips -- ../chess-yes-voice/clips.json
//
// Node loads vocabulary.ts directly with its built-in TypeScript type stripping (on by
// default since Node 22.18 and 23.6), which is why that file has no runtime imports. The
// output is deterministic, one clip per line, so changes to the list read well in a diff.
// Render the pack again whenever the list changes (VOCABULARY_VERSION in vocabulary.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { clipList } from '../src/voice/vocabulary.ts';

const out = process.argv[2];
if (!out) {
  console.error('Usage: npm run voice:clips -- <output path>');
  process.exit(1);
}

const list = clipList();
const keys = new Set(list.clips.map((clip) => clip.key));
if (keys.size !== list.clips.length) throw new Error('Duplicate clip keys in vocabulary.ts');

const clips = list.clips.map((clip) => `    ${JSON.stringify({ key: clip.key, text: clip.text })}`);
const json = [
  '{',
  `  "version": ${JSON.stringify(list.version)},`,
  `  "voice": ${JSON.stringify(list.voice)},`,
  '  "clips": [',
  clips.join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');

const path = resolve(out);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, json);
console.log(`${path}: ${list.clips.length} clips (voice ${list.voice}, version ${list.version})`);
