#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { runDoctorCommand } from './commands/doctor.mjs';
import { initUsage, runInitCommand } from './commands/init.mjs';
import { pluginUsage, runPluginCommand } from './commands/plugin.mjs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const usage = `Usage:
  trueadmin init <directory>
  trueadmin plugin <command>
  trueadmin doctor

${initUsage}

${pluginUsage}`;

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
