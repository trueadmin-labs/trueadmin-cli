import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { runDoctorCommand } from './doctor.mjs';
import { runHyperfCoverageCommand } from './hyperf.mjs';
import { validatePlugins } from './plugin.mjs';
import { runRuntimeCheck } from './runtime.mjs';
import { workspacePaths } from '../shared/workspace.mjs';

export const checkUsage = `Usage:
  trueadmin check [--full] [--scope hyperf|web]`;

const parseCheckArgs = (args) => {
  const options = {
    full: false,
    scope: 'all',
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--full') {
      options.full = true;
      continue;
    }
    if (arg === '--scope') {
      const value = args[index + 1];
      if (!['hyperf', 'web'].includes(value)) {
        throw new Error(`Option [--scope] must be hyperf or web.\n${checkUsage}`);
      }
      options.scope = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length);
      if (!['hyperf', 'web'].includes(value)) {
        throw new Error(`Option [--scope] must be hyperf or web.\n${checkUsage}`);
      }
      options.scope = value;
      continue;
    }

    throw new Error(`Unknown option [${arg}].\n${checkUsage}`);
  }

  return options;
};

const runStage = (title, callback) => {
  console.log(`\n==> ${title}`);
  try {
    const ok = callback();
    if (!ok) {
      console.log(`FAIL ${title}`);
      return false;
    }
    console.log(`PASS ${title}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${title}`);
    console.log(error instanceof Error ? error.message : String(error));
    return false;
  }
};

const runCommandStage = (title, command, args, cwd) =>
  runStage(title, () => {
    const result = spawnSync(command, args, {
      cwd,
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }

    return result.status === 0;
  });

export const runCheckCommand = (args, paths = workspacePaths()) => {
  const options = parseCheckArgs(args);
  if (options.help) {
    console.log(checkUsage);
    return true;
  }

  const includeHyperf = options.scope === 'all' || options.scope === 'hyperf';
  const includeWeb = options.scope === 'all' || options.scope === 'web';
  const results = [];

  results.push(runStage('runtime check', () => runRuntimeCheck(paths)));
  results.push(runStage('doctor', () => runDoctorCommand(paths)));
  results.push(
    runStage('plugin validate', () => {
      validatePlugins(paths);
      console.log('Plugin config is valid.');
      return true;
    }),
  );

  if (includeHyperf) {
    results.push(runCommandStage('hyperf analyse', 'composer', ['analyse'], paths.hyperfRoot));
    results.push(runCommandStage('hyperf test', 'composer', ['test'], paths.hyperfRoot));
    if (options.full) {
      results.push(runStage('hyperf coverage', () => runHyperfCoverageCommand([], paths)));
    }
  }

  if (includeWeb) {
    results.push(runCommandStage('web check', 'pnpm', ['--dir', 'web', 'check'], paths.root));
    if (options.full) {
      results.push(runCommandStage('web test coverage', 'pnpm', ['--dir', 'web', 'test:coverage'], paths.root));
      results.push(runCommandStage('web e2e', 'pnpm', ['--dir', 'web', 'e2e'], paths.root));
    }
  }

  const ok = results.every(Boolean);
  process.exitCode = ok ? 0 : 1;
  return ok;
};
