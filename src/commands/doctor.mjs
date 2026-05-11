import fs from 'node:fs';
import path from 'node:path';
import { objectValue, stringValue } from '../shared/format.mjs';
import { relativePath, workspacePaths } from '../shared/workspace.mjs';
import { generatedPluginConfig, readPluginConfig, validatePlugins } from './plugin.mjs';

export const runDoctorCommand = (paths = workspacePaths()) => {
  const checks = [
    checkWorkspace(paths),
    checkPluginConfig(paths),
    checkGeneratedPluginFiles(paths),
    checkInstalledPluginRuntime(paths),
    checkRuntimeConfigBoundaries(paths),
    checkRuntimeSourceBoundaries(paths),
  ];

  const failed = checks.filter((check) => check.status === 'fail');

  console.log('TrueAdmin doctor');
  for (const check of checks) {
    console.log(` ${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.title}`);
    if (check.detail) {
      console.log(`      ${check.detail}`);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

const pass = (title, detail = '') => ({ status: 'pass', title, detail });
const fail = (title, detail = '') => ({ status: 'fail', title, detail });

const checkWorkspace = (paths) => {
  for (const required of ['backend', 'web', 'plugins']) {
    if (!fs.existsSync(path.join(paths.root, required))) {
      return fail('workspace layout', `Missing ${required}/ under ${paths.root}.`);
    }
  }

  return pass('workspace layout', relativePath(paths.root, paths.root));
};

const checkPluginConfig = (paths) => {
  try {
    validatePlugins(paths);
    return pass('plugin config', 'plugins.config.json is valid.');
  } catch (error) {
    return fail('plugin config', error instanceof Error ? error.message : String(error));
  }
};

const checkGeneratedPluginFiles = (paths) => {
  try {
    const generated = generatedPluginConfig(paths);
    const files = [
      [paths.backendPluginConfig, generated.backend],
      [paths.webPluginConfig, generated.web],
    ];
    const stale = files
      .filter(([file, expected]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected)
      .map(([file]) => relativePath(paths.root, file));

    if (stale.length > 0) {
      return fail('generated plugin files', `Run trueadmin plugin sync. Stale: ${stale.join(', ')}`);
    }

    return pass('generated plugin files', 'backend and web plugin config are synchronized.');
  } catch (error) {
    return fail('generated plugin files', error instanceof Error ? error.message : String(error));
  }
};

const checkInstalledPluginRuntime = (paths) => {
  const config = readPluginConfig(paths);
  const installed = objectValue(config.installed);
  const missing = [];

  for (const [id, definition] of Object.entries(installed)) {
    const item = objectValue(definition);
    for (const field of ['backendPath', 'webPath']) {
      const runtimePath = stringValue(item[field], '');
      if (runtimePath && !fs.existsSync(path.join(paths.root, runtimePath))) {
        missing.push(`${id}:${runtimePath}`);
      }
    }
  }

  if (missing.length > 0) {
    return fail('installed plugin runtime', `Missing runtime paths: ${missing.join(', ')}`);
  }

  return pass('installed plugin runtime', `${Object.keys(installed).length} plugin(s) installed.`);
};

const checkRuntimeConfigBoundaries = (paths) => {
  const violations = [];

  if (fs.existsSync(paths.backendPluginConfig)) {
    const content = fs.readFileSync(paths.backendPluginConfig, 'utf8');
    for (const pattern of ['plugins.config.json', 'web/config', 'web/src/plugins', 'marketplaces']) {
      if (content.includes(pattern)) {
        violations.push(`${relativePath(paths.root, paths.backendPluginConfig)} references ${pattern}`);
      }
    }
  }

  if (fs.existsSync(paths.webPluginConfig)) {
    const content = fs.readFileSync(paths.webPluginConfig, 'utf8');
    for (const pattern of ['plugins.config.json', 'backend/config', 'backend/plugins', 'marketplaces']) {
      if (content.includes(pattern)) {
        violations.push(`${relativePath(paths.root, paths.webPluginConfig)} references ${pattern}`);
      }
    }
  }

  if (violations.length > 0) {
    return fail('runtime config boundaries', violations.join('; '));
  }

  return pass('runtime config boundaries', 'generated endpoint configs only contain endpoint-local facts.');
};

const checkRuntimeSourceBoundaries = (paths) => {
  const violations = [
    ...scanFiles(paths.backendRoot, ['plugins.config.json', 'web/config', 'web/src/plugins', '../web', '../../plugins/']),
    ...scanFiles(paths.webRoot, ['plugins.config.json', 'backend/config', 'backend/plugins', '../backend', '../../plugins/']),
  ];

  if (violations.length > 0) {
    return fail('runtime source boundaries', violations.slice(0, 8).join('; '));
  }

  return pass('runtime source boundaries', 'backend and web runtime code do not read cross-end framework config.');
};

const scanFiles = (root, forbiddenPatterns) => {
  if (!fs.existsSync(root)) {
    return [];
  }

  const violations = [];
  const stack = [root];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', 'runtime', 'dist', 'build', '.vite', '.turbo']);
  const allowedExtensions = new Set([
    '.php',
    '.json',
    '.mjs',
    '.js',
    '.cjs',
    '.ts',
    '.tsx',
    '.md',
    '.yml',
    '.yaml',
  ]);

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          stack.push(file);
        }
        continue;
      }

      if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name))) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push(`${relativePath(path.dirname(root), file)} references ${pattern}`);
          break;
        }
      }
    }
  }

  return violations;
};
