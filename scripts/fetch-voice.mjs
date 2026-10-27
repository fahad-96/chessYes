// Installs the coach voice pack (pre-rendered MP3 clips, see voice-pack.json and
// https://github.com/fahad-96/chess-yes-voice) into public/voice-pack/, so the site serves
// the clips itself. Runs on npm install, before `npm run dev` and before every build.
//
//   node scripts/fetch-voice.mjs
//   VOICE_PACK_DIR=../chess-yes-voice/pack node scripts/fetch-voice.mjs   (a local render)
//   VOICE_PACK_SKIP=1 node scripts/fetch-voice.mjs                          (do nothing)
//
// - Skips the download when public/voice-pack/ already holds the version voice-pack.json names.
// - Downloads the release archive, checks its sha256 against voice-pack.json (refusing any
//   mismatch) and unpacks it with a small ustar + gzip reader (scripts/lib/voice-pack.mjs).
// - Never fails the install or the build: on any problem it prints a warning and the app
//   speaks with the device's own voice instead.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSha256, manifestProblems, sha256Hex, unpackVoicePack } from './lib/voice-pack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'voice-pack');
const staging = join(root, 'public', 'voice-pack.partial');
/** What was installed and from where; kept out of public/ so it is never deployed. */
const stampPath = join(root, 'node_modules', '.cache', 'chess-yes', 'voice-pack.json');
const DOWNLOAD_TIMEOUT_MS = 180_000;

const log = (message) => console.log(`[fetch-voice] ${message}`);
const warn = (message) => console.warn(`[fetch-voice] WARNING: ${message}`);

try {
  await main();
} catch (error) {
  warn(`${error instanceof Error ? error.message : error}`);
  warn(
    existsSync(join(target, 'manifest.json'))
      ? 'the voice pack installed before is kept.'
      : 'the coach voice is not installed; the app will use the device voice.',
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
  process.exitCode = 0;
}

async function main() {
  if (process.env.VOICE_PACK_SKIP) {
    log('VOICE_PACK_SKIP is set; skipping.');
    return;
  }
  const config = JSON.parse(readFileSync(join(root, 'voice-pack.json'), 'utf8'));
  if (!Number.isInteger(config.version) || typeof config.url !== 'string') {
    throw new Error('voice-pack.json needs a "version" number and a "url"');
  }
  if (process.env.VOICE_PACK_DIR) {
    installFromFolder(resolve(process.env.VOICE_PACK_DIR), config);
    return;
  }

  const installed = readJson(join(target, 'manifest.json'));
  const stamp = readJson(stampPath);
  if (installed?.version === config.version) {
    // Without a stamp the pack's origin is unknown; its version is what matters.
    if (!isSha256(config.sha256) || !stamp || stamp.sha256 === config.sha256) {
      log(`voice pack v${config.version} already installed (${countClips(installed)} clips).`);
      return;
    }
  }
  if (!isSha256(config.sha256)) {
    warn(
      `voice-pack.json has no sha256 yet ("${config.sha256}"), so the pack is not downloaded.` +
        " Fill it in from the release's .sha256 file, or set VOICE_PACK_DIR to a local pack.",
    );
    warn('until then the app uses the device voice.');
    return;
  }

  log(`downloading ${config.url}`);
  const response = await fetch(config.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} for ${config.url}`);
  const gz = Buffer.from(await response.arrayBuffer());
  const { files, manifest } = unpackVoicePack(gz, config);
  install(files.map(({ path, data }) => ({ name: path, write: (to) => writeFileSync(to, data) })));
  writeStamp({ version: config.version, sha256: config.sha256.toLowerCase(), source: 'download' });
  log(
    `installed voice pack v${manifest.version} (${countClips(manifest)} clips,` +
      ` ${(gz.length / 1048576).toFixed(1)} MB) into public/voice-pack`,
  );
}

/** Copies a local pack folder (a render's output, or a release unpacked by hand). */
function installFromFolder(folder, config) {
  const manifestPath = join(folder, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`VOICE_PACK_DIR has no manifest.json: ${folder}`);
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(`bad manifest.json in ${folder}: ${problems.join('; ')}`);
  if (manifest.version !== config.version) {
    warn(
      `the pack in ${folder} is version ${manifest.version}; voice-pack.json says ${config.version}.`,
    );
  }
  const clipFiles = [...new Set(Object.values(manifest.clips).map((clip) => clip.file))];
  const missing = clipFiles.filter((file) => !existsSync(join(folder, file)));
  if (missing.length) {
    throw new Error(`${missing.length} clip files are missing in ${folder} (e.g. ${missing[0]})`);
  }

  const manifestSha = sha256Hex(manifestBytes);
  const stamp = readJson(stampPath);
  const current = existsSync(join(target, 'manifest.json'))
    ? sha256Hex(readFileSync(join(target, 'manifest.json')))
    : null;
  if (stamp?.source === 'folder' && stamp.folder === folder && current === manifestSha) {
    log(`local voice pack already installed from ${folder} (${clipFiles.length} clips).`);
    return;
  }

  const extras = ['LICENSE-AUDIO'].filter((file) => existsSync(join(folder, file)));
  install(
    ['manifest.json', ...extras, ...clipFiles].map((name) => ({
      name,
      write: (to) => copyFileSync(join(folder, name), to),
    })),
  );
  writeStamp({ version: manifest.version, sha256: null, source: 'folder', folder });
  log(`installed the local voice pack from ${folder} (${clipFiles.length} clips).`);
}

/** Writes the files into a staging folder, then swaps it in for public/voice-pack. */
function install(files) {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const file of files) file.write(join(staging, file.name));
  // The manifest goes first: a removal cut short then leaves no pack that looks complete.
  rmSync(join(target, 'manifest.json'), { force: true });
  rmSync(target, { recursive: true, force: true });
  try {
    renameSync(staging, target);
  } catch {
    // Windows refuses to rename a folder that a running dev server watches: copy instead,
    // manifest.json last, so a copy cut short is not taken for a complete pack next time.
    mkdirSync(target, { recursive: true });
    const names = readdirSync(staging).sort(
      (a, b) => Number(a === 'manifest.json') - Number(b === 'manifest.json'),
    );
    for (const name of names) copyFileSync(join(staging, name), join(target, name));
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeStamp(stamp) {
  if (!existsSync(join(root, 'node_modules'))) return;
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n');
}

function countClips(manifest) {
  return Object.keys(manifest?.clips ?? {}).length;
}
