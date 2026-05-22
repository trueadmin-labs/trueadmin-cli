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
    checkBackendAdminMiddlewareBoundary(paths),
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

  return failed.length === 0;
};

const pass = (title, detail = '') => ({ status: 'pass', title, detail });
const fail = (title, detail = '') => ({ status: 'fail', title, detail });

const checkWorkspace = (paths) => {
  for (const required of ['hyperf', 'web', 'plugins']) {
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
      [paths.hyperfPluginConfig, generated.hyperf],
      [paths.webPluginConfig, generated.web],
    ];
    const stale = files
      .filter(([file, expected]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected)
      .map(([file]) => relativePath(paths.root, file));

    if (stale.length > 0) {
      return fail('generated plugin files', `Run trueadmin plugin sync. Stale: ${stale.join(', ')}`);
    }

    return pass('generated plugin files', 'hyperf and web plugin config are synchronized.');
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
    for (const field of ['hyperfPath', 'webPath']) {
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
    const hyperfSource = path.join(sourceRoot, 'hyperf/php');
    const webSource = path.join(sourceRoot, 'web');
    const hyperfRuntime = path.join(paths.root, stringValue(item.hyperfPath, ''));
    const webRuntime = path.join(paths.root, stringValue(item.webPath, ''));

    if (fs.existsSync(hyperfSource) || fs.existsSync(hyperfRuntime)) {
      drift.push(
        ...compareDirectoryTrees(hyperfSource, hyperfRuntime).map(
          (entry) => `${id}:hyperf:${entry}`,
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

  if (fs.existsSync(paths.hyperfPluginConfig)) {
    const content = fs.readFileSync(paths.hyperfPluginConfig, 'utf8');
    for (const pattern of ['plugins.config.json', 'web/config', 'web/src/plugins', 'marketplaces']) {
      if (content.includes(pattern)) {
        violations.push(`${relativePath(paths.root, paths.hyperfPluginConfig)} references ${pattern}`);
      }
    }
  }

  if (fs.existsSync(paths.webPluginConfig)) {
    const content = fs.readFileSync(paths.webPluginConfig, 'utf8');
    for (const pattern of ['plugins.config.json', 'hyperf/config', 'hyperf/plugins', 'marketplaces']) {
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
    ...scanFiles(paths.hyperfRoot, ['plugins.config.json', 'web/config', 'web/src/plugins', '../web', '../../plugins/']),
    ...scanFiles(paths.webRoot, ['plugins.config.json', 'hyperf/config', 'hyperf/plugins', '../hyperf', '../../plugins/']),
  ];

  if (violations.length > 0) {
    return fail('runtime source boundaries', violations.slice(0, 8).join('; '));
  }

  return pass('runtime source boundaries', 'hyperf and web runtime code do not read cross-end framework config.');
};

const checkBackendMenuResourceBoundary = (paths) => {
  const violations = scanFiles(paths.hyperfRoot, ['#[Menu']);

  if (violations.length > 0) {
    return fail('hyperf menu resource boundary', violations.slice(0, 8).join('; '));
  }

  return pass('hyperf menu resource boundary', 'hyperf menus are declared by resources/menus.php.');
};

const checkBackendPublicPermissionBoundary = (paths) => {
  const violations = [
    ...scanFilesByRegex(paths.hyperfRoot, /#\[\s*Permission\s*\([^)]*public\s*:/s, 'uses unsupported #[Permission(public: ...)]'),
    ...scanFilesByRegex(paths.pluginSourceRoot, /#\[\s*Permission\s*\([^)]*public\s*:/s, 'uses unsupported #[Permission(public: ...)]'),
  ];

  if (violations.length > 0) {
    return fail('hyperf public permission boundary', violations.slice(0, 8).join('; '));
  }

  return pass('hyperf public permission boundary', 'Permission attributes do not use unsupported public mode.');
};

const checkBackendAdminMiddlewareBoundary = (paths) => {
  const violations = [
    ...scanAdminRouteMiddlewareBoundaries(paths.hyperfRoot),
    ...scanAdminRouteMiddlewareBoundaries(paths.pluginSourceRoot),
  ];

  if (violations.length > 0) {
    return fail('hyperf admin middleware boundary', violations.slice(0, 8).join('; '));
  }

  return pass('hyperf admin middleware boundary', 'permissioned admin controllers declare auth and permission middleware in order.');
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
    ...checkComposerFile(path.join(paths.hyperfRoot, 'composer.json'), paths),
    ...checkBackendAnnotationFile(path.join(paths.hyperfRoot, 'config/autoload/annotations.php'), paths),
  ];

  if (violations.length > 0) {
    return fail('template package boundaries', violations.join('; '));
  }

  return pass('template package boundaries', 'workspace package references follow the 2.0 development boundary.');
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

const scanAdminRouteMiddlewareBoundaries = (root) => {
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

      if (!entry.isFile() || path.extname(entry.name) !== '.php') {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      if (!isAdminControllerSource(file, content)) {
        continue;
      }

      const relative = relativePath(path.dirname(root), file);
      const attributes = phpAttributes(content);
      const classIndex = content.search(/\bclass\s+[A-Za-z_][A-Za-z0-9_]*/);
      const classAttributes = classIndex === -1 ? [] : attributes.filter((attribute) => attribute.end <= classIndex);
      const classMiddleware = classAttributes
        .filter((attribute) => isAttribute(attribute.source, ['AdminController', 'AdminRouteController']))
        .flatMap((attribute) => middlewareClasses(attribute.source));
      const classAuthIndex = classMiddleware.indexOf('AdminAuthMiddleware');
      const classPermissionIndex = classMiddleware.indexOf('PermissionMiddleware');
      const classHasPermission = classAttributes.some((attribute) => isAttribute(attribute.source, ['Permission']));
      const functionMatches = [...content.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g)];
      let previousFunctionEnd = classIndex === -1 ? 0 : classIndex;

      for (const functionMatch of functionMatches) {
        const functionIndex = functionMatch.index ?? 0;
        const methodAttributes = attributes.filter(
          (attribute) => attribute.start >= previousFunctionEnd && attribute.end <= functionIndex,
        );
        const routeAttributes = methodAttributes.filter((attribute) => isAdminRouteMappingAttribute(attribute.source));
        if (routeAttributes.length === 0) {
          previousFunctionEnd = functionIndex + functionMatch[0].length;
          continue;
        }

        const methodHasPermission = methodAttributes.some((attribute) => isAttribute(attribute.source, ['Permission']));
        const requiresPermission = classHasPermission || methodHasPermission;
        if (requiresPermission && classPermissionIndex === -1) {
          violations.push(`${relative} declares #[Permission] without class-level PermissionMiddleware`);
        }
        if (classPermissionIndex !== -1 && classAuthIndex === -1) {
          violations.push(`${relative} uses class-level PermissionMiddleware without AdminAuthMiddleware`);
        }
        if (classPermissionIndex !== -1 && classAuthIndex !== -1 && classAuthIndex > classPermissionIndex) {
          violations.push(`${relative} lists class-level PermissionMiddleware before AdminAuthMiddleware`);
        }

        for (const routeAttribute of routeAttributes) {
          const routeMiddleware = uniqueClasses([
            ...classMiddleware,
            ...middlewareClasses(routeAttribute.source),
          ]);

          const permissionIndex = routeMiddleware.indexOf('PermissionMiddleware');
          const authIndex = routeMiddleware.indexOf('AdminAuthMiddleware');

          if (requiresPermission && permissionIndex === -1) {
            violations.push(`${relative} declares #[Permission] without PermissionMiddleware`);
          }
          if (permissionIndex !== -1 && authIndex === -1) {
            violations.push(`${relative} uses PermissionMiddleware without AdminAuthMiddleware`);
          }
          if (permissionIndex !== -1 && authIndex !== -1 && authIndex > permissionIndex) {
            violations.push(`${relative} lists PermissionMiddleware before AdminAuthMiddleware`);
          }
        }

        previousFunctionEnd = functionIndex + functionMatch[0].length;
      }
    }
  }

  return violations;
};

const isAdminControllerSource = (file, content) => {
  const segments = file.split(path.sep);

  return /#\[\s*Admin(?:Route)?Controller\b/.test(content) || (segments.includes('Admin') && segments.includes('Controller'));
};

const isAdminRouteMappingAttribute = (source) =>
  isAttribute(source, ['AdminGet', 'AdminPost', 'AdminPut', 'AdminDelete']);

const isAttribute = (source, names) => {
  const argumentIndex = source.indexOf('(');
  const endIndex = argumentIndex === -1 ? source.indexOf(']') : argumentIndex;
  const name = source
    .slice(0, endIndex === -1 ? source.length : endIndex)
    .replace(/^#\[\s*/, '')
    .trim()
    .split('\\')
    .pop();

  return name !== undefined && names.includes(name);
};

const middlewareClasses = (source) => {
  const match = source.match(/middleware\s*:\s*\[([\s\S]*?)\]/);
  if (!match) {
    return [];
  }

  return [...match[1].matchAll(/([A-Za-z_][A-Za-z0-9_\\\\]*)::class/g)].map((item) => classBasename(item[1]));
};

const classBasename = (className) => className.split('\\').pop() ?? className;

const uniqueClasses = (classes) => {
  const seen = new Set();
  const result = [];
  for (const className of classes) {
    if (!seen.has(className)) {
      seen.add(className);
      result.push(className);
    }
  }

  return result;
};

const phpAttributes = (content) => {
  const attributes = [];
  let index = 0;

  while (index < content.length) {
    const start = content.indexOf('#[', index);
    if (start === -1) {
      break;
    }

    let depth = 0;
    let end = start;
    for (; end < content.length; end += 1) {
      if (content[end] === '[') {
        depth += 1;
      } else if (content[end] === ']') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }

    attributes.push({
      source: content.slice(start, end),
      start,
      end,
    });
    index = end;
  }

  return attributes;
};

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
