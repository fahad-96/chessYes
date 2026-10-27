import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isSha256, readTar, sha256Hex, unpackVoicePack } from './voice-pack.mjs';

/** A minimal ustar writer (the same layout as chess-yes-voice/lib/tar.mjs) for fixtures. */
function tar(entries) {
  const parts = [];
  for (const { path, data } of entries) {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, 'ascii');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const manifest = {
  version: 1,
  voice: 'af_bella',
  clips: {
    'move:Nf3': { file: 'move-nf3-c76686.mp3', ms: 1095 },
    'sq:e4': { file: 'sq-e4-64378d.mp3', ms: 675 },
  },
};

function pack({ files, version = 1 } = {}) {
  const entries = files ?? [
    { path: 'manifest.json', data: Buffer.from(JSON.stringify({ ...manifest, version })) },
    { path: 'LICENSE-AUDIO', data: Buffer.from('CC BY 4.0') },
    { path: 'move-nf3-c76686.mp3', data: Buffer.from('ID3 fake knight') },
    { path: 'sq-e4-64378d.mp3', data: Buffer.alloc(700, 7) },
  ];
  const gz = gzipSync(tar(entries));
  return { gz, sha256: sha256Hex(gz) };
}

describe('readTar', () => {
  it('reads back every file, including ones that span several blocks', () => {
    const files = readTar(tar([{ path: 'a.mp3', data: Buffer.alloc(1300, 1) }]));
    expect(files.map((f) => [f.path, f.data.length])).toEqual([['a.mp3', 1300]]);
  });

  it('rejects a corrupted header', () => {
    const archive = tar([{ path: 'a.mp3', data: Buffer.from('x') }]);
    archive[0] = 'b'.charCodeAt(0);
    expect(() => readTar(archive)).toThrow(/checksum/);
  });
});

describe('unpackVoicePack', () => {
  it('unpacks an archive whose sha256 matches', () => {
    const { gz, sha256 } = pack();
    const { files, manifest: read } = unpackVoicePack(gz, { sha256, version: 1 });
    expect(files.map((f) => f.path)).toEqual([
      'manifest.json',
      'LICENSE-AUDIO',
      'move-nf3-c76686.mp3',
      'sq-e4-64378d.mp3',
    ]);
    expect(files[3].data.length).toBe(700);
    expect(read.clips['move:Nf3'].ms).toBe(1095);
  });

  it('refuses a sha256 mismatch, and a missing sha256', () => {
    const { gz, sha256 } = pack();
    const wrong = sha256.replace(/^./, sha256[0] === '0' ? '1' : '0');
    expect(() => unpackVoicePack(gz, { sha256: wrong, version: 1 })).toThrow(/sha256 mismatch/);
    expect(() => unpackVoicePack(gz, { sha256: 'PENDING', version: 1 })).toThrow(/sha256/);
    expect(isSha256('PENDING')).toBe(false);
    expect(isSha256(sha256)).toBe(true);
  });

  it('refuses paths that are not plain file names', () => {
    const { gz, sha256 } = pack({
      files: [
        { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        { path: '../evil.mp3', data: Buffer.from('x') },
      ],
    });
    expect(() => unpackVoicePack(gz, { sha256, version: 1 })).toThrow(/unexpected path/);
  });

  it('refuses another version or a pack with clips missing', () => {
    const other = pack({ version: 2 });
    expect(() => unpackVoicePack(other.gz, { sha256: other.sha256, version: 1 })).toThrow(
      /version 2/,
    );
    const partial = pack({
      files: [
        { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        { path: 'move-nf3-c76686.mp3', data: Buffer.from('x') },
      ],
    });
    expect(() => unpackVoicePack(partial.gz, { sha256: partial.sha256, version: 1 })).toThrow(
      /1 clips are missing/,
    );
  });
});
