#!/usr/bin/env node

import process from 'node:process';
import { runDoctorCommand } from './commands/doctor.mjs';
import { pluginUsage, runPluginCommand } from './commands/plugin.mjs';

const usage = `Usage:
  trueadmin plugin <command>
  trueadmin doctor

${pluginUsage}`;

const main = () => {
  const [command, ...args] = process.argv.slice(2);

  try {
    if (command === 'plugin') {
      runPluginCommand(args);
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
