import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_TEMPLATE_REPO = 'https://github.com/trueadmin-labs/trueadmin.git';
const SSH_TEMPLATE_REPO = 'git@github.com:trueadmin-labs/trueadmin.git';
const DEFAULT_BRANCH = '2.0';

export const initUsage = `Usage:
  trueadmin init <directory> [--template <git-url-or-path>] [--branch <name>] [--ssh] [--keep-git] [--no-mobile]

Options:
  --template, -t  Git repository or local repository path to clone.
  --branch, -b    Template branch to clone. Defaults to 2.0.
  --ssh           Use the TrueAdmin SSH template URL.
  --keep-git      Keep the template .git directory after cloning.
  --no-mobile     Remove the mobile/ placeholder from the initialized project.`;

export const runInitCommand = (args, cwd = process.cwd()) => {
  const options = parseInitArgs(args);

  if (options.help) {
    console.log(initUsage);
    return;
  }

  const targetName = options.positionals[0];
  if (!targetName || options.positionals.length > 1) {
    throw new Error(`Missing or invalid project directory.\n${initUsage}`);
  }

  const targetPath = path.resolve(cwd, targetName);
  assertWritableTarget(targetPath);

  const cloneArgs = ['clone', '--depth=1', '--branch', options.branch, '--single-branch', options.template, targetPath];
  console.log(`Creating TrueAdmin project in ${targetPath}`);
  const result = spawnSync('git', cloneArgs, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error('Template clone failed.');
  }

  if (!options.keepGit) {
    fs.rmSync(path.join(targetPath, '.git'), { recursive: true, force: true });
  }
  if (options.noMobile) {
    fs.rmSync(path.join(targetPath, 'mobile'), { recursive: true, force: true });
  }

  console.log('');
  console.log('Project created.');
  console.log('Next steps:');
  console.log(`  cd ${displayTargetPath(targetName, targetPath, cwd)}`);
  console.log('  npm install');
  console.log('  pnpm --dir web install');
  console.log('  composer --working-dir=hyperf install');
  console.log('  cp .env.example .env');
  console.log('  cp hyperf/.env.example hyperf/.env');
  console.log('  docker compose -f deploy/docker/docker-compose.yml up -d');
  console.log('  php hyperf/bin/hyperf.php migrate:fresh --seed');
  console.log('  npm run doctor');
};

const parseInitArgs = (args) => {
  const options = {
    template: process.env.TRUEADMIN_TEMPLATE_REPO || DEFAULT_TEMPLATE_REPO,
    branch: process.env.TRUEADMIN_TEMPLATE_BRANCH || DEFAULT_BRANCH,
    keepGit: false,
    noMobile: false,
    help: false,
    positionals: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--template' || arg === '-t') {
      options.template = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--branch' || arg === '-b') {
      options.branch = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--ssh') {
      options.template = SSH_TEMPLATE_REPO;
      continue;
    }
    if (arg === '--keep-git') {
      options.keepGit = true;
      continue;
    }
    if (arg === '--no-mobile') {
      options.noMobile = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option [${arg}].\n${initUsage}`);
    }

    options.positionals.push(arg);
  }

  return options;
};

const readOptionValue = (args, index, option) => {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Option [${option}] requires a value.`);
  }

  return value;
};

const assertWritableTarget = (targetPath) => {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Target [${targetPath}] exists and is not a directory.`);
  }

  const entries = fs.readdirSync(targetPath).filter((entry) => entry !== '.DS_Store');
  if (entries.length > 0) {
    throw new Error(`Target directory [${targetPath}] is not empty.`);
  }
};

const displayTargetPath = (targetName, targetPath, cwd) => {
  if (path.isAbsolute(targetName)) {
    return targetPath;
  }

  return path.relative(cwd, targetPath) || '.';
};
