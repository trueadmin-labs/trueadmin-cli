import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { objectValue } from '../shared/format.mjs';
import { workspacePaths } from '../shared/workspace.mjs';

export const runtimeUsage = `Usage:
  trueadmin runtime check`;

const pass = (title, detail) => ({ status: 'pass', title, detail });
const fail = (title, detail) => ({ status: 'fail', title, detail });

const readRuntimeConfig = (paths) => {
  const packageFile = path.join(paths.root, 'package.json');
  if (!fs.existsSync(packageFile)) {
    return {};
  }

  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  return objectValue(objectValue(packageJson.trueadmin).runtime);
};

const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'unknown command error',
    };
  }
};

const extractVersion = (value) => {
  const matched = value.match(/\d+\.\d+(?:\.\d+)?/);
  return matched ? matched[0] : null;
};

const compare = (actual, expected, mode) => {
  if (!actual || !expected) {
    return false;
  }

  if (mode === 'exact') {
    return actual === expected;
  }

  return actual === expected || actual.startsWith(`${expected}.`);
};

const checkCommandVersion = ({ title, command, args, expected, mode = 'prefix', cwd, hint }) => {
  const output = run(command, args, { cwd });
  if (typeof output === 'object' && output.error) {
    return fail(title, `${command} unavailable. ${hint}`);
  }

  const actual = extractVersion(output) ?? output;
  if (!compare(actual, expected, mode)) {
    return fail(title, `expected ${expected}, got ${actual}. ${hint}`);
  }

  return pass(title, actual);
};

export const collectRuntimeChecks = (paths = workspacePaths()) => {
  const runtime = readRuntimeConfig(paths);

  return [
    compare(process.version.slice(1), runtime.node, 'exact')
      ? pass('Node.js', process.version.slice(1))
      : fail('Node.js', `expected ${runtime.node}, got ${process.version.slice(1)}. Run \`nvm use\`.`),
    checkCommandVersion({
      title: 'npm',
      command: 'npm',
      args: ['--version'],
      expected: runtime.npm,
      hint: `Use the npm bundled with Node ${runtime.node}.`,
    }),
    checkCommandVersion({
      title: 'pnpm (web)',
      command: 'pnpm',
      args: ['--version'],
      expected: runtime.pnpm,
      mode: 'exact',
      cwd: paths.webRoot,
      hint: `Run \`corepack enable\` and then \`corepack prepare pnpm@${runtime.pnpm} --activate\`.`,
    }),
    checkCommandVersion({
      title: 'PHP',
      command: 'php',
      args: ['-r', 'echo PHP_VERSION;'],
      expected: runtime.php,
      hint: `Use PHP ${runtime.php}.x for the backend toolchain.`,
    }),
    checkCommandVersion({
      title: 'Composer',
      command: 'composer',
      args: ['--version'],
      expected: runtime.composer,
      hint: `Use Composer ${runtime.composer}.x for the backend toolchain.`,
    }),
  ];
};

export const runRuntimeCheck = (paths = workspacePaths()) => {
  const checks = collectRuntimeChecks(paths);
  const failed = checks.filter((check) => check.status === 'fail');

  console.log('TrueAdmin runtime check');
  for (const check of checks) {
    console.log(` ${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.title}`);
    if (check.detail) {
      console.log(`      ${check.detail}`);
    }
  }

  return failed.length === 0;
};

export const runRuntimeCommand = (args, paths = workspacePaths()) => {
  const [subcommand] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(runtimeUsage);
    return true;
  }

  if (subcommand !== 'check') {
    console.log(runtimeUsage);
    process.exitCode = 1;
    return false;
  }

  const ok = runRuntimeCheck(paths);
  process.exitCode = ok ? 0 : 1;
  return ok;
};
