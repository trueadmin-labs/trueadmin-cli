import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('../src/index.mjs', import.meta.url));

const runCli = (...args) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
  });

test('prints top-level help without requiring a workspace', () => {
  const result = runCli('--help');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /trueadmin init <directory>/);
  assert.equal(result.stderr, '');
});

test('prints plugin help without requiring a workspace', () => {
  const result = runCli('plugin', '--help');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /trueadmin plugin list/);
  assert.equal(result.stderr, '');
});

test('returns a failing status for unknown commands', () => {
  const result = runCli('unknown-command');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage:/);
});
