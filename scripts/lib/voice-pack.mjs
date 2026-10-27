// Reading and installing the coach voice pack (see scripts/fetch-voice.mjs). Pure Node, no
// dependencies: the archive is a gzipped ustar file written by the chess-yes-voice repository
// (its lib/tar.mjs), holding manifest.json, LICENSE-AUDIO and the MP3 clips in one flat folder.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;
/** Uncompressed size limit: the real pack is about 25 MB, so this only stops a gzip bomb. */
export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
/** Names allowed in the pack: flat, URL-safe, nothing that could leave the target folder. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** True for a well-formed sha256 (64 hex digits); "PENDING" and typos are not. */
export function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Regular files of a ustar archive, as { path, data } in archive order. */
export function readTar(buf) {
  const files = [];
  let offset = 0;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header.toString('ascii', start, start + length).replace(/\0.*$/s, '');
    const stored = parseInt(field(148, 8).trim(), 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== stored) throw new Error(`bad tar header checksum at offset ${offset}`);
    const prefix = field(345, 155);
    const path = (prefix ? `${prefix}/` : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim(), 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`bad tar size for ${path}`);
    const type = field(156, 1) || '0';
    offset += BLOCK;
    if (offset + size > buf.length) throw new Error(`tar archive truncated in ${path}`);
    if (type === '0') files.push({ path, data: buf.subarray(offset, offset + size) });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/** Checks a parsed manifest.json; returns a list of problems (empty when it is usable). */
export function manifestProblems(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest.json is not an object'];
  if (!Number.isInteger(manifest.version)) problems.push('"version" is not an integer');
  if (!manifest.clips || typeof manifest.clips !== 'object') problems.push('"clips" is missing');
  else {
    for (const [key, clip] of Object.entries(manifest.clips)) {
      if (!clip || typeof clip.file !== 'string' || !SAFE_NAME.test(clip.file)) {
        problems.push(`clip ${key} has a bad file name`);
      } else if (!(typeof clip.ms === 'number' && clip.ms > 0)) {
        problems.push(`clip ${key} has a bad duration`);
      }
      if (problems.length > 5) break;
    }
  }
  return problems;
}

/**
 * Verifies and unpacks a downloaded pack. Throws on a sha256 mismatch, a broken archive, a
 * path that is not a plain file name, a manifest of another version, or a clip whose file is
 * missing. Returns the files to write and the parsed manifest.
 *
 * @param {Buffer} gz the .tar.gz as downloaded
 * @param {{ sha256: string, version: number }} expected from voice-pack.json
 */
export function unpackVoicePack(gz, expected) {
  const actual = sha256Hex(gz);
  if (!isSha256(expected.sha256)) throw new Error('voice-pack.json has no valid sha256');
  if (actual !== expected.sha256.toLowerCase()) {
    throw new Error(`sha256 mismatch: expected ${expected.sha256}, got ${actual}`);
  }
  const tar = gunzipSync(gz, { maxOutputLength: MAX_UNPACKED_BYTES });
  const files = readTar(tar);
  const names = new Set();
  for (const { path } of files) {
    if (!SAFE_NAME.test(path)) throw new Error(`unexpected path in the voice pack: ${path}`);
    if (names.has(path)) throw new Error(`duplicate file in the voice pack: ${path}`);
    names.add(path);
  }
  const manifestFile = files.find((file) => file.path === 'manifest.json');
  if (!manifestFile) throw new Error('the voice pack has no manifest.json');
  const manifest = JSON.parse(manifestFile.data.toString('utf8'));
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(`bad manifest.json: ${problems.join('; ')}`);
  if (manifest.version !== expected.version) {
    throw new Error(
      `the pack is version ${manifest.version}, voice-pack.json wants ${expected.version}`,
    );
  }
  const missing = Object.values(manifest.clips)
    .map((clip) => clip.file)
    .filter((file) => !names.has(file));
  if (missing.length) {
    throw new Error(`${missing.length} clips are missing from the archive (e.g. ${missing[0]})`);
  }
  return { files, manifest };
}
