#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { checkUsage, runCheckCommand } from './commands/check.mjs';
import { runDoctorCommand } from './commands/doctor.mjs';
import { hyperfUsage, runHyperfCommand } from './commands/hyperf.mjs';
import { initUsage, runInitCommand } from './commands/init.mjs';
import { pluginUsage, runPluginCommand } from './commands/plugin.mjs';
import { runtimeUsage, runRuntimeCommand } from './commands/runtime.mjs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const usage = `Usage:
  trueadmin init <directory>
  trueadmin doctor
  trueadmin check [--full]
  trueadmin runtime check
  trueadmin plugin <command>
  trueadmin hyperf <command>

${initUsage}

${checkUsage}

${runtimeUsage}

${pluginUsage}

${hyperfUsage}`;

const main = () => {
  const [command, ...args] = process.argv.slice(2);

  try {
    if (!command || command === '--help' || command === '-h') {
      console.log(usage);
      return;
    }
    if (command === '--version' || command === '-v') {
      console.log(packageJson.version);
      return;
    }
    if (command === 'plugin') {
      runPluginCommand(args);
      return;
    }
    if (command === 'runtime') {
      runRuntimeCommand(args);
      return;
    }
    if (command === 'check') {
      runCheckCommand(args);
      return;
    }
    if (command === 'hyperf') {
      runHyperfCommand(args);
      return;
    }
    if (command === 'init') {
      runInitCommand(args);
      return;
    }
    if (command === 'doctor') {
      runDoctorCommand();
      return;
    }

    console.log(usage);
    process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

main();
