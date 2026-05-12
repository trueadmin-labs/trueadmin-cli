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
    checkInstalledPluginRuntimeDrift(paths),
    checkRuntimeConfigBoundaries(paths),
    checkRuntimeSourceBoundaries(paths),
    checkBackendMenuResourceBoundary(paths),
    checkBackendPublicPermissionBoundary(paths),
    checkWebManifestMenuBoundary(paths),
    checkWebEnvConfigBoundary(paths),
    checkTemplatePackageBoundaries(paths),
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

const checkInstalledPluginRuntimeDrift = (paths) => {
  const config = readPluginConfig(paths);
  const installed = objectValue(config.installed);
  const drift = [];

  for (const [id, definition] of Object.entries(installed)) {
    const item = objectValue(definition);
    const source = stringValue(item.source, '');
    if (!source) {
      continue;
    }

    const sourceRoot = path.join(paths.root, source);
    const backendSource = path.join(sourceRoot, 'backend/php');
    const webSource = path.join(sourceRoot, 'web');
    const backendRuntime = path.join(paths.root, stringValue(item.backendPath, ''));
    const webRuntime = path.join(paths.root, stringValue(item.webPath, ''));

    if (fs.existsSync(backendSource) || fs.existsSync(backendRuntime)) {
      drift.push(
        ...compareDirectoryTrees(backendSource, backendRuntime).map(
          (entry) => `${id}:backend:${entry}`,
        ),
      );
    }

    if (fs.existsSync(webSource) || fs.existsSync(webRuntime)) {
      drift.push(...compareDirectoryTrees(webSource, webRuntime).map((entry) => `${id}:web:${entry}`));
    }
  }

  if (drift.length > 0) {
    return fail('installed plugin runtime drift', drift.slice(0, 8).join('; '));
  }

  return pass('installed plugin runtime drift', 'installed plugin runtimes match source packages.');
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

const checkBackendMenuResourceBoundary = (paths) => {
  const violations = scanFiles(paths.backendRoot, ['#[Menu']);

  if (violations.length > 0) {
    return fail('backend menu resource boundary', violations.slice(0, 8).join('; '));
  }

  return pass('backend menu resource boundary', 'backend menus are declared by resources/menus.php.');
};

const checkBackendPublicPermissionBoundary = (paths) => {
  const violations = [
    ...scanFilesByRegex(paths.backendRoot, /#\[\s*Permission\s*\([^)]*public\s*:\s*true/s, 'declares #[Permission(public: true)]'),
    ...scanFilesByRegex(paths.pluginSourceRoot, /#\[\s*Permission\s*\([^)]*public\s*:\s*true/s, 'declares #[Permission(public: true)]'),
  ];

  if (violations.length > 0) {
    return fail('backend public permission boundary', violations.slice(0, 8).join('; '));
  }

  return pass('backend public permission boundary', 'login-only admin APIs omit #[Permission] instead of using public permissions.');
};

const checkWebManifestMenuBoundary = (paths) => {
  const violations = [
    ...scanManifestFiles(path.join(paths.webRoot, 'src')),
    ...scanManifestFiles(paths.pluginSourceRoot),
  ];

  if (violations.length > 0) {
    return fail('web manifest menu boundary', violations.slice(0, 8).join('; '));
  }

  return pass('web manifest menu boundary', 'web manifests only declare runtime routes and module metadata.');
};

const checkWebEnvConfigBoundary = (paths) => {
  const sourceRoot = path.join(paths.webRoot, 'src');
  const violations = scanFiles(sourceRoot, ['import.meta.env', 'process.env']);

  if (violations.length > 0) {
    return fail('web env config boundary', violations.slice(0, 8).join('; '));
  }

  return pass('web env config boundary', 'web runtime reads env only through web/config.');
};

const checkTemplatePackageBoundaries = (paths) => {
  const violations = [
    ...checkPackageFile(path.join(paths.root, 'package.json'), paths),
    ...checkPackageFile(path.join(paths.webRoot, 'package.json'), paths),
    ...checkComposerFile(path.join(paths.backendRoot, 'composer.json'), paths),
    ...checkBackendAnnotationFile(path.join(paths.backendRoot, 'config/autoload/annotations.php'), paths),
  ];

  if (violations.length > 0) {
    return fail('template package boundaries', violations.join('; '));
  }

  return pass('template package boundaries', 'template uses published framework packages instead of local path references.');
};

const checkPackageFile = (file, paths) => {
  if (!fs.existsSync(file)) {
    return [];
  }

  const violations = [];
  const packageJson = readJsonFile(file);
  const relative = relativePath(paths.root, file);
  const scripts = objectValue(packageJson.scripts);

  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === 'string' && command.includes('../trueadmin-cli')) {
      violations.push(`${relative} script [${name}] references ../trueadmin-cli`);
    }
  }

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = objectValue(packageJson[section]);
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier !== 'string') {
        continue;
      }
      if (specifier === 'latest') {
        violations.push(`${relative} ${section}.${name} uses latest`);
      }
      if (
        isTrueAdminPackage(name) &&
        (specifier.startsWith('file:') || specifier.startsWith('link:') || specifier.startsWith('workspace:'))
      ) {
        violations.push(`${relative} ${section}.${name} uses local specifier [${specifier}]`);
      }
    }
  }

  return violations;
};

const checkComposerFile = (file, paths) => {
  if (!fs.existsSync(file)) {
    return [];
  }

  const composer = readJsonFile(file);
  const repositories = Array.isArray(composer.repositories)
    ? composer.repositories
    : Object.values(objectValue(composer.repositories));
  const violations = [];

  for (const repository of repositories) {
    const item = objectValue(repository);
    if (typeof item.url !== 'string') {
      continue;
    }

    if (item.type === 'path' && item.url.includes('trueadmin')) {
      violations.push(`${relativePath(paths.root, file)} repositories contains local TrueAdmin path [${item.url}]`);
    }
    if (item.type === 'vcs' && item.url.includes('trueadmin')) {
      violations.push(`${relativePath(paths.root, file)} repositories contains TrueAdmin VCS [${item.url}]`);
    }
  }

  return violations;
};

const checkBackendAnnotationFile = (file, paths) => {
  if (!fs.existsSync(file)) {
    return [];
  }

  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('../../trueadmin-kernel')) {
    return [`${relativePath(paths.root, file)} references ../../trueadmin-kernel`];
  }

  return [];
};

const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const isTrueAdminPackage = (name) => name === 'trueadmin' || name.startsWith('@trueadmin/');

const scanFilesByRegex = (root, pattern, message) => {
  if (!fs.existsSync(root)) {
    return [];
  }

  const violations = [];
  const stack = [root];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', 'runtime', 'dist', 'build', '.vite', '.turbo']);
  const allowedExtensions = new Set(['.php']);

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

      if (pattern.test(fs.readFileSync(file, 'utf8'))) {
        violations.push(`${relativePath(path.dirname(root), file)} ${message}`);
      }
    }
  }

  return violations;
};

const scanManifestFiles = (root) => {
  if (!fs.existsSync(root)) {
    return [];
  }

  const violations = [];
  const stack = [root];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', 'runtime', 'dist', 'build', '.vite', '.turbo']);

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

      if (!entry.isFile() || !/^manifest\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      if (/\bmenus\s*:/.test(content)) {
        violations.push(`${relativePath(path.dirname(root), file)} declares manifest.menus`);
      }
    }
  }

  return violations;
};

const compareDirectoryTrees = (source, target) => {
  const differences = [];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', 'runtime', 'dist', 'build', '.vite', '.turbo']);
  const sourceFiles = collectRelativeFiles(source, ignoredDirectories);
  const targetFiles = collectRelativeFiles(target, ignoredDirectories);
  const allFiles = new Set([...sourceFiles.keys(), ...targetFiles.keys()]);

  for (const file of [...allFiles].sort()) {
    const sourceFile = sourceFiles.get(file);
    const targetFile = targetFiles.get(file);
    if (!sourceFile) {
      differences.push(`source missing ${file}`);
      continue;
    }
    if (!targetFile) {
      differences.push(`runtime missing ${file}`);
      continue;
    }
    if (fs.readFileSync(sourceFile, 'utf8') !== fs.readFileSync(targetFile, 'utf8')) {
      differences.push(`changed ${file}`);
    }
  }

  return differences;
};

const collectRelativeFiles = (root, ignoredDirectories) => {
  const files = new Map();
  if (!fs.existsSync(root)) {
    return files;
  }

  const stack = [root];
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
      if (entry.isFile()) {
        files.set(path.relative(root, file), file);
      }
    }
  }

  return files;
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
