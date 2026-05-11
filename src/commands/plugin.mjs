import fs from 'node:fs';
import path from 'node:path';
import { backendRelativePath, exportPhp, exportTs, objectValue, stringList, stringValue } from '../shared/format.mjs';
import { relativePath, workspacePaths } from '../shared/workspace.mjs';

export const pluginUsage = `Usage:
  trueadmin plugin list
  trueadmin plugin validate
  trueadmin plugin install <vendor/name|vendor.name> [--force] [--disabled]
  trueadmin plugin sync`;

export const readPluginConfig = (paths = workspacePaths()) => {
  if (!fs.existsSync(paths.pluginConfig)) {
    return { installed: {}, disabled: [], config: {}, marketplaces: [] };
  }

  return JSON.parse(fs.readFileSync(paths.pluginConfig, 'utf8'));
};

export const writePluginConfig = (config, paths = workspacePaths()) => {
  fs.writeFileSync(paths.pluginConfig, `${JSON.stringify(sortInstalled(config), null, 2)}\n`);
};

export const listPlugins = (paths = workspacePaths()) => {
  const config = readPluginConfig(paths);
  const installed = objectValue(config.installed);
  const disabled = stringList(config.disabled);
  const ids = Object.keys(installed).sort();

  console.log('Plugins:');
  if (ids.length === 0) {
    console.log(' - none');
    return;
  }

  for (const id of ids) {
    const definition = objectValue(installed[id]);
    const enabled = Boolean(definition.enabled ?? true) && !disabled.includes(id);
    console.log(
      ` - ${id}:${stringValue(definition.version, 'unknown')} [${enabled ? 'enabled' : 'disabled'}] ${stringValue(definition.backendPath, '')}`,
    );
  }
};

export const validatePlugins = (paths = workspacePaths()) => {
  const config = readPluginConfig(paths);
  const installed = objectValue(config.installed);

  for (const [id, definition] of Object.entries(installed)) {
    const item = objectValue(definition);
    const packageSource = stringValue(item.source, '');
    if (!packageSource) {
      throw new Error(`Plugin [${id}] is missing source.`);
    }

    const pluginJson = readPluginJson(path.join(paths.root, packageSource), paths);
    if (pluginJson.id !== id) {
      throw new Error(`Installed plugin [${id}] source plugin.json declares [${pluginJson.id}].`);
    }

    for (const runtimePath of [item.backendPath, item.webPath].filter(Boolean)) {
      if (!fs.existsSync(path.join(paths.root, runtimePath))) {
        throw new Error(`Installed plugin [${id}] runtime is missing [${runtimePath}].`);
      }
    }
  }
};

export const installPlugin = (args, paths = workspacePaths()) => {
  const pluginName = args.find((arg) => !arg.startsWith('--'));
  if (!pluginName) {
    throw new Error(`Missing plugin name.\n${pluginUsage}`);
  }

  const force = args.includes('--force');
  const enabled = !args.includes('--disabled');
  const { vendor, name, id } = parsePluginName(pluginName);
  const source = `plugins/${vendor}/${name}`;
  const sourcePath = path.join(paths.root, source);
  const pluginJson = readPluginJson(sourcePath, paths);

  if (pluginJson.id !== id || pluginJson.vendor !== vendor || pluginJson.name !== name) {
    throw new Error(`plugin.json identity must match package path [${vendor}/${name}].`);
  }

  const config = readPluginConfig(paths);
  assertPluginDependencies(pluginJson, objectValue(config.installed));

  const backendPath = `backend/plugins/${vendor}/${name}`;
  const webPath = `web/src/plugins/${vendor}/${name}`;
  const backendCopied = mirrorRuntime(path.join(sourcePath, 'backend/php'), path.join(paths.root, backendPath), force, paths);
  const webCopied = mirrorRuntime(path.join(sourcePath, 'web'), path.join(paths.root, webPath), force, paths);

  config.installed = objectValue(config.installed);
  const existing = objectValue(config.installed[id]);
  config.installed[id] = {
    source,
    backendPath,
    webPath,
    version: pluginJson.version,
    enabled,
    defaults: objectValue(existing.defaults),
  };
  config.disabled = stringList(config.disabled).filter((disabledId) => disabledId !== id);
  config.config = objectValue(config.config);
  config.marketplaces = Array.isArray(config.marketplaces) ? config.marketplaces : [];

  writePluginConfig(config, paths);
  syncPluginConfig(paths);

  console.log(`Plugin installed: ${id}:${pluginJson.version} [${enabled ? 'enabled' : 'disabled'}]`);
  console.log(`Runtime copied: backend=${backendCopied ? 'yes' : 'no'}, web=${webCopied ? 'yes' : 'no'}`);
};

export const generatedPluginConfig = (paths = workspacePaths()) => {
  const config = readPluginConfig(paths);

  return {
    backend: renderBackendPluginConfig(config),
    web: renderWebPluginConfig(config),
  };
};

export const syncPluginConfig = (paths = workspacePaths()) => {
  validatePlugins(paths);
  const generated = generatedPluginConfig(paths);

  fs.writeFileSync(paths.backendPluginConfig, generated.backend);
  fs.writeFileSync(paths.webPluginConfig, generated.web);
};

export const runPluginCommand = (args, paths = workspacePaths()) => {
  const [subcommand, ...rest] = args;

  if (subcommand === 'list') {
    listPlugins(paths);
    return;
  }
  if (subcommand === 'validate') {
    validatePlugins(paths);
    console.log('Plugin config is valid.');
    return;
  }
  if (subcommand === 'install') {
    installPlugin(rest, paths);
    return;
  }
  if (subcommand === 'sync') {
    syncPluginConfig(paths);
    console.log('Plugin config synced.');
    return;
  }

  console.log(pluginUsage);
  process.exitCode = subcommand ? 1 : 0;
};

const renderBackendPluginConfig = (config) => {
  const installed = objectValue(config.installed);
  const backendInstalled = {};

  for (const [id, definition] of Object.entries(installed).sort(([a], [b]) => a.localeCompare(b))) {
    const item = objectValue(definition);
    backendInstalled[id] = {
      path: `BACKEND_BASE_PATH:${backendRelativePath(stringValue(item.backendPath, ''))}`,
      version: stringValue(item.version, 'unknown'),
      enabled: Boolean(item.enabled ?? true),
      defaults: objectValue(item.defaults),
    };
  }

  const backendConfig = {
    installed: backendInstalled,
    disabled: stringList(config.disabled),
    config: objectValue(config.config),
    marketplaces: Array.isArray(config.marketplaces) ? config.marketplaces : [],
  };

  return `<?php\n\n` +
    `declare(strict_types=1);\n\n` +
    `// This file is generated by trueadmin plugin sync. Do not edit manually.\n\n` +
    `return ${exportPhp(backendConfig)};\n`;
};

const renderWebPluginConfig = (config) => {
  const installed = objectValue(config.installed);
  const disabled = stringList(config.disabled);
  const projectConfig = objectValue(config.config);
  const webConfig = {};

  for (const [id, definition] of Object.entries(installed).sort(([a], [b]) => a.localeCompare(b))) {
    const item = objectValue(definition);
    const entry = {
      enabled: Boolean(item.enabled ?? true) && !disabled.includes(id),
    };
    if (projectConfig[id] && Object.keys(objectValue(projectConfig[id])).length > 0) {
      entry.config = objectValue(projectConfig[id]);
    }
    webConfig[id] = entry;
  }

  return `// This file is generated by trueadmin plugin sync. Do not edit manually.\n` +
    `import type { PluginRuntimeConfig } from '@/core/plugin/types';\n\n` +
    `export const pluginConfig: Record<string, PluginRuntimeConfig> = ${exportTs(webConfig)};\n`;
};

const readPluginJson = (sourcePath, paths) => {
  const file = path.join(sourcePath, 'plugin.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Plugin package [${relativePath(paths.root, sourcePath)}] is missing plugin.json.`);
  }

  const decoded = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const field of ['id', 'vendor', 'name', 'version']) {
    if (typeof decoded[field] !== 'string' || decoded[field] === '') {
      throw new Error(`plugin.json field [${field}] is required.`);
    }
  }

  const dependencies = objectValue(decoded.dependencies);
  const plugins = dependencies.plugins ?? [];
  if (!Array.isArray(plugins) || plugins.some((plugin) => typeof plugin !== 'string' || plugin === '')) {
    throw new Error('plugin.json dependencies.plugins must be a string list.');
  }

  return decoded;
};

const mirrorRuntime = (source, target, force, paths) => {
  if (!fs.existsSync(source)) {
    return false;
  }
  if (fs.existsSync(target)) {
    if (!force) {
      throw new Error(`Runtime target [${relativePath(paths.root, target)}] already exists. Use --force to overwrite it.`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return true;
};

const assertPluginDependencies = (pluginJson, installed) => {
  const dependencies = objectValue(pluginJson.dependencies);
  const plugins = stringList(dependencies.plugins);
  for (const dependency of plugins) {
    if (!installed[dependency]) {
      throw new Error(`Plugin [${pluginJson.id}] requires missing plugin [${dependency}].`);
    }
  }
};

const sortInstalled = (config) => ({
  installed: Object.fromEntries(Object.entries(objectValue(config.installed)).sort(([a], [b]) => a.localeCompare(b))),
  disabled: stringList(config.disabled),
  config: objectValue(config.config),
  marketplaces: Array.isArray(config.marketplaces) ? config.marketplaces : [],
});

const parsePluginName = (pluginName) => {
  const normalized = pluginName.trim();
  const separator = normalized.includes('/') ? '/' : '.';
  const [vendor, name, ...rest] = normalized.split(separator);
  if (!vendor || !name || rest.length > 0 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(vendor) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Plugin name [${pluginName}] must use vendor/name or vendor.name.`);
  }
  return { vendor, name, id: `${vendor}.${name}` };
};
