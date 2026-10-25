import * as portableSnapshot from '../fixtures/native-review-snapshot.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Electron treats .asar as a virtual directory. Raw fixture reads need its
// original filesystem; this helper is test-only and never shipped in the plugin.
const diskFs = process.versions.electron ? createRequire(import.meta.url)('original-fs') : fs;

export const archivePath = process.env.DSH_ARCHIVE ?? 'D:/DeepSeek Harness/resources/app.asar';

/** Read a file from an ASAR without extracting or changing the installation. */
export function readArchive(relativePath) {
  const fd = diskFs.openSync(archivePath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    diskFs.readSync(fd, prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    diskFs.readSync(fd, header, 0, header.length, 16);
    let entry = JSON.parse(header);
    for (const component of relativePath.split('/')) entry = entry.files[component];
    if (!entry || entry.unpacked || entry.offset === undefined) throw new Error('Expected a packed regular fixture file.');
    const bytes = Buffer.alloc(entry.size);
    const offset = 8 + prefix.readUInt32LE(4) + Number(entry.offset);
    if (diskFs.readSync(fd, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error('Incomplete fixture read.');
    return bytes.toString('utf8');
  } finally { diskFs.closeSync(fd); }
}

export function nativeFixture(BlockAssembler) {
  if (!BlockAssembler) return portableSnapshot;
  const source = readArchive('dsh/node_modules/@deepseek-ai/dsh-experimental-auto-review/lib/index.js');
  const testSource = source.replace(/^import .*;\r?\n/gm, '').replace(/^export \{[^\n]*\};?\r?$/gm, '');
  return vm.runInNewContext(testSource + '\n;({ REVIEW_POLICY, parseDecision, readDecision });', { BlockAssembler });
}

export function reviewRequest(overrides = {}) {
  const { REVIEW_POLICY } = nativeFixture();
  return {
    provider: 'fixture-provider', model: 'fixture-model', system: REVIEW_POLICY, temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: [
      'ENVIRONMENT', JSON.stringify({ cwd: 'D:/example' }),
      'PROJECT_INSTRUCTIONS', '[]', 'FILTERED_HISTORY', '[]',
      'PENDING_ACTION', JSON.stringify({ mode: 'native', name: 'working_directory', description: 'Read cwd', parameters: {}, arguments: {} }),
    ].join('\n\n') }] }],
    ...overrides,
  };
}
