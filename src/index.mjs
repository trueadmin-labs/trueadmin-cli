#!/usr/bin/env node

import process from 'node:process';
import { runDoctorCommand } from './commands/doctor.mjs';
import { initUsage, runInitCommand } from './commands/init.mjs';
import { pluginUsage, runPluginCommand } from './commands/plugin.mjs';

const usage = `Usage:
  trueadmin init <directory>
  trueadmin plugin <command>
  trueadmin doctor

${initUsage}

${pluginUsage}`;

const main = () => {
  const [command, ...args] = process.argv.slice(2);

  try {
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
    process.exitCode = command ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

main();
