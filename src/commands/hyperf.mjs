import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { objectValue } from '../shared/format.mjs';
import { workspacePaths } from '../shared/workspace.mjs';

export const hyperfUsage = `Usage:
  trueadmin hyperf coverage`;

const readCoverageThresholds = (paths) => {
  const fallback = { statements: 20, methods: 22, conditionals: 12, modules: {} };
  const packageFile = path.join(paths.root, 'package.json');
  if (!fs.existsSync(packageFile)) {
    return fallback;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const coverage = objectValue(objectValue(packageJson.trueadmin).coverage);
  const thresholds = objectValue(coverage.hyperf ?? coverage.backend);

  return Object.keys(thresholds).length > 0 ? thresholds : fallback;
};

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const detectCoverageDriver = (backendRoot) => {
  const modules = run('php', ['-m'], backendRoot)
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase());
  if (modules.includes('xdebug')) {
    return { phpArgs: ['-d', 'xdebug.mode=coverage'], label: 'xdebug (loaded)' };
  }
  if (modules.includes('pcov')) {
    return { phpArgs: ['-d', 'pcov.enabled=1'], label: 'pcov (loaded)' };
  }

  const extensionDir = run('php-config', ['--extension-dir'], backendRoot);
  const xdebug = path.join(extensionDir, 'xdebug.so');
  if (fs.existsSync(xdebug)) {
    return {
      phpArgs: ['-d', `zend_extension=${xdebug}`, '-d', 'xdebug.mode=coverage'],
      label: `xdebug (${xdebug})`,
    };
  }

  const pcov = path.join(extensionDir, 'pcov.so');
  if (fs.existsSync(pcov)) {
    return {
      phpArgs: ['-d', `extension=${pcov}`, '-d', 'pcov.enabled=1'],
      label: `pcov (${pcov})`,
    };
  }

  throw new Error('No Xdebug or PCOV coverage driver is available for the Hyperf backend.');
};

const toNumber = (value) => Number.parseInt(String(value ?? '0'), 10);
const toPercent = ({ covered, total }) => Number(((covered / total) * 100).toFixed(2));
const normalizeRelative = (value) => value.replace(/\\/g, '/').replace(/^\/+/, '');

const logicalCoveragePath = (relativeFile) => {
  if (!relativeFile.startsWith('runtime/container/proxy/App_') || !relativeFile.endsWith('.proxy.php')) {
    return relativeFile;
  }

  return `app/${relativeFile
    .replace(/^runtime\/container\/proxy\/App_/, '')
    .replace(/\.proxy\.php$/, '.php')
    .replace(/_/g, '/')}`;
};

const parseCoverageMetrics = (cloverFile) => {
  const content = fs.readFileSync(cloverFile, 'utf8');
  const metrics = [...content.matchAll(/<metrics\s+([^>]+)\/>/g)];
  if (metrics.length === 0) {
    throw new Error('Failed to parse backend Clover coverage metrics.');
  }

  const matched = metrics.at(-1)?.[1];
  if (!matched) {
    throw new Error('Failed to locate backend Clover summary metrics.');
  }

  const attributes = Object.fromEntries(
    [...matched.matchAll(/([a-z]+)="([^"]+)"/g)].map(([, key, value]) => [key, value]),
  );

  return {
    content,
    statements: {
      total: toNumber(attributes.statements),
      covered: toNumber(attributes.coveredstatements),
    },
    conditionals: {
      total: toNumber(attributes.conditionals),
      covered: toNumber(attributes.coveredconditionals),
    },
    methods: {
      total: toNumber(attributes.methods),
      covered: toNumber(attributes.coveredmethods),
    },
  };
};

const collectLogicalFiles = (content, backendRoot) => {
  const fileMatches = [...content.matchAll(/<file name="([^"]+)">([\s\S]*?)<\/file>/g)];
  const logicalFiles = new Map();

  for (const [, absoluteFile, body] of fileMatches) {
    const relativeFile = normalizeRelative(path.relative(backendRoot, absoluteFile));
    const metricsMatch = body.match(/<metrics\s+([^>]+)\/>/);
    if (!metricsMatch) {
      continue;
    }

    const attrs = Object.fromEntries(
      [...metricsMatch[1].matchAll(/([a-z]+)="([^"]+)"/g)].map(([, key, value]) => [key, value]),
    );

    const logicalFile = logicalCoveragePath(relativeFile);
    if (!logicalFile.startsWith('app/')) {
      continue;
    }

    const candidate = {
      physicalFile: relativeFile,
      logicalFile,
      statements: {
        total: toNumber(attrs.statements),
        covered: toNumber(attrs.coveredstatements),
      },
      methods: {
        total: toNumber(attrs.methods),
        covered: toNumber(attrs.coveredmethods),
      },
    };

    const existing = logicalFiles.get(logicalFile);
    const preferCandidate =
      !existing ||
      (existing.physicalFile.startsWith('app/') && candidate.physicalFile.startsWith('runtime/')) ||
      (candidate.physicalFile.startsWith('runtime/') &&
        existing.physicalFile.startsWith('runtime/') &&
        candidate.statements.covered + candidate.methods.covered >
          existing.statements.covered + existing.methods.covered);

    if (preferCandidate) {
      logicalFiles.set(logicalFile, candidate);
    }
  }

  return [...logicalFiles.values()];
};

const summarizeCoverage = (content, moduleThresholds, backendRoot) => {
  const logicalFiles = collectLogicalFiles(content, backendRoot);
  const modules = Object.entries(moduleThresholds ?? {}).map(([key, config]) => ({
    key,
    label: config.label ?? key,
    include: (config.include ?? []).map((entry) => normalizeRelative(String(entry))),
    statementsMin: Number(config.statements ?? 0),
    methodsMin: Number(config.methods ?? 0),
    statements: { total: 0, covered: 0 },
    methods: { total: 0, covered: 0 },
    files: 0,
  }));
  const global = {
    statements: { total: 0, covered: 0 },
    methods: { total: 0, covered: 0 },
  };

  for (const file of logicalFiles) {
    global.statements.total += file.statements.total;
    global.statements.covered += file.statements.covered;
    global.methods.total += file.methods.total;
    global.methods.covered += file.methods.covered;

    for (const module of modules) {
      if (!module.include.some((prefix) => file.logicalFile.startsWith(prefix))) {
        continue;
      }

      module.files += 1;
      module.statements.total += file.statements.total;
      module.statements.covered += file.statements.covered;
      module.methods.total += file.methods.total;
      module.methods.covered += file.methods.covered;
      break;
    }
  }

  for (const module of modules) {
    if (module.files === 0) {
      throw new Error(`Configured backend coverage module [${module.label}] did not match any covered files.`);
    }
  }

  return {
    global: {
      statements: global.statements.total > 0 ? toPercent(global.statements) : null,
      methods: global.methods.total > 0 ? toPercent(global.methods) : null,
    },
    modules: modules.map((module) => ({
      key: module.key,
      label: module.label,
      files: module.files,
      statements: module.statements.total > 0 ? toPercent(module.statements) : null,
      methods: module.methods.total > 0 ? toPercent(module.methods) : null,
      statementsMin: module.statementsMin,
      methodsMin: module.methodsMin,
    })),
  };
};

export const runHyperfCoverageCommand = (args = [], paths = workspacePaths()) => {
  const [option] = args;
  if (option === '--help' || option === '-h') {
    console.log(hyperfUsage);
    return true;
  }

  const thresholds = readCoverageThresholds(paths);
  const backendRoot = paths.hyperfRoot;
  const coverageRoot = path.join(paths.root, 'output', 'coverage', 'backend');
  const cloverFile = path.join(coverageRoot, 'clover.xml');
  const htmlDir = path.join(coverageRoot, 'html');
  const driver = detectCoverageDriver(backendRoot);

  fs.rmSync(coverageRoot, { recursive: true, force: true });
  fs.mkdirSync(coverageRoot, { recursive: true });
  fs.rmSync(path.join(backendRoot, 'runtime', 'container'), { recursive: true, force: true });
  fs.mkdirSync(path.join(backendRoot, 'runtime', 'container', 'proxy'), { recursive: true });

  console.log(`TrueAdmin Hyperf coverage (${driver.label})`);
  const command = spawnSync(
    'php',
    [
      ...driver.phpArgs,
      './vendor/bin/co-phpunit',
      '--prepend',
      'test/bootstrap.php',
      '--colors=always',
      '--coverage-clover',
      cloverFile,
      '--coverage-html',
      htmlDir,
      '--coverage-text=php://stdout',
      '--only-summary-for-coverage-text',
      '--coverage-filter',
      './app',
      '--coverage-filter',
      './runtime/container/proxy',
    ],
    {
      cwd: backendRoot,
      stdio: 'inherit',
    },
  );

  if (command.error) {
    throw command.error;
  }
  if (command.status !== 0) {
    process.exitCode = command.status;
    return false;
  }

  const metrics = parseCoverageMetrics(cloverFile);
  const coverage = summarizeCoverage(metrics.content, thresholds.modules, backendRoot);
  const summary = {
    statements: coverage.global.statements,
    conditionals: metrics.conditionals.total > 0 ? toPercent(metrics.conditionals) : null,
    methods: coverage.global.methods,
  };
  const moduleSummaries = coverage.modules;

  if ((summary.statements ?? 0) === 0 && (summary.methods ?? 0) === 0) {
    throw new Error('Hyperf coverage report was generated, but statements and methods are both 0%.');
  }

  console.log('Hyperf coverage gate');
  console.log(' logical files: app/* plus proxy-backed classes folded from runtime/container/proxy/App_*.proxy.php');
  console.log(` statements: ${summary.statements ?? 'n/a'}% (min ${thresholds.statements}%)`);
  if (summary.conditionals === null) {
    console.log(' conditionals: n/a (Clover report does not expose conditional totals)');
  } else {
    console.log(` conditionals: ${summary.conditionals}% (min ${thresholds.conditionals}%)`);
  }
  console.log(` methods: ${summary.methods ?? 'n/a'}% (min ${thresholds.methods}%)`);
  console.log(' module gates:');
  for (const module of moduleSummaries) {
    console.log(
      `  ${module.label}: statements ${module.statements ?? 'n/a'}% (min ${module.statementsMin}%), methods ${module.methods ?? 'n/a'}% (min ${module.methodsMin}%), files ${module.files}`,
    );
  }

  const checks = [
    summary.statements !== null ? summary.statements >= thresholds.statements : true,
    summary.conditionals !== null ? summary.conditionals >= thresholds.conditionals : true,
    summary.methods !== null ? summary.methods >= thresholds.methods : true,
    ...moduleSummaries.map((module) => (module.statements ?? 0) >= module.statementsMin),
    ...moduleSummaries.map((module) => (module.methods ?? 0) >= module.methodsMin),
  ];
  const ok = checks.every(Boolean);
  process.exitCode = ok ? 0 : 1;
  return ok;
};

export const runHyperfCommand = (args, paths = workspacePaths()) => {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(hyperfUsage);
    return true;
  }

  if (subcommand !== 'coverage') {
    console.log(hyperfUsage);
    process.exitCode = 1;
    return false;
  }

  return runHyperfCoverageCommand(rest, paths);
};
