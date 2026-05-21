import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInitCommand } from '../src/commands/init.mjs';

const execGit = (args, cwd) => {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
  });
};

const makeTemplateRepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trueadmin-init-template-'));

  execGit(['init'], root);
  execGit(['checkout', '-B', 'main'], root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'trueadmin-template-fixture', private: true }, null, 2),
  );
  fs.writeFileSync(path.join(root, 'README.md'), '# TrueAdmin Template Fixture\n');
  execGit(['add', '.'], root);
  execGit(
    [
      '-c',
      'user.name=TrueAdmin Test',
      '-c',
      'user.email=trueadmin@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'initial template',
    ],
    root,
  );

  return root;
};

const makeWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trueadmin-init-workspace-'));

const captureConsole = (callback) => {
  const originalLog = console.log;
  const messages = [];
  console.log = (...args) => {
    messages.push(args.join(' '));
  };
  try {
    callback();
  } finally {
    console.log = originalLog;
  }
  return messages.join('\n');
};

test('init clones a template and removes git metadata by default', () => {
  const template = pathToFileURL(makeTemplateRepo()).href;
  const cwd = makeWorkspace();

  const output = captureConsole(() => runInitCommand(['demo', '--template', template, '--branch', 'main'], cwd));

  assert.equal(fs.existsSync(path.join(cwd, 'demo/package.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'demo/.git')), false);
  assert.match(output, /pnpm --dir web install/);
  assert.match(output, /composer --working-dir=hyperf install/);
  assert.match(output, /docker compose -f deploy\/docker\/docker-compose\.yml up -d/);
  assert.match(output, /php hyperf\/bin\/hyperf\.php migrate:fresh --seed/);
});

test('init keeps git metadata when requested', () => {
  const template = pathToFileURL(makeTemplateRepo()).href;
  const cwd = makeWorkspace();

  runInitCommand(['demo', '--template', template, '--branch', 'main', '--keep-git'], cwd);

  assert.equal(fs.existsSync(path.join(cwd, 'demo/package.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'demo/.git')), true);
});

test('init refuses non-empty target directories', () => {
  const template = pathToFileURL(makeTemplateRepo()).href;
  const cwd = makeWorkspace();
  fs.mkdirSync(path.join(cwd, 'demo'));
  fs.writeFileSync(path.join(cwd, 'demo/existing.txt'), 'already here');

  assert.throws(
    () => runInitCommand(['demo', '--template', template, '--branch', 'main'], cwd),
    /not empty/,
  );
});
