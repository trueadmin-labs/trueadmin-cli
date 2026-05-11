import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  generatedPluginConfig,
  readPluginConfig,
  syncPluginConfig,
  validatePlugins,
  writePluginConfig,
} from '../src/commands/plugin.mjs';

const makeWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trueadmin-cli-'));
  const paths = {
    root,
    pluginConfig: path.join(root, 'plugins.config.json'),
    pluginSourceRoot: path.join(root, 'plugins'),
    backendRoot: path.join(root, 'backend'),
    backendPluginRuntimeRoot: path.join(root, 'backend/plugins'),
    backendPluginConfig: path.join(root, 'backend/config/autoload/plugins.php'),
    webRoot: path.join(root, 'web'),
    webPluginRuntimeRoot: path.join(root, 'web/src/plugins'),
    webPluginConfig: path.join(root, 'web/config/plugin.ts'),
  };

  fs.mkdirSync(path.dirname(paths.backendPluginConfig), { recursive: true });
  fs.mkdirSync(path.dirname(paths.webPluginConfig), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins/acme/demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend/plugins/acme/demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'web/src/plugins/acme/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugins/acme/demo/plugin.json'),
    JSON.stringify(
      {
        id: 'acme.demo',
        vendor: 'acme',
        name: 'demo',
        version: '1.2.3',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    paths.pluginConfig,
    JSON.stringify(
      {
        installed: {
          'acme.demo': {
            source: 'plugins/acme/demo',
            backendPath: 'backend/plugins/acme/demo',
            webPath: 'web/src/plugins/acme/demo',
            version: '1.2.3',
            enabled: true,
            defaults: {
              color: 'blue',
            },
          },
        },
        disabled: [],
        config: {
          'acme.demo': {
            color: 'green',
          },
        },
        marketplaces: [],
      },
      null,
      2,
    ),
  );

  return paths;
};

test('validates installed plugin identity and runtime boundaries', () => {
  const paths = makeWorkspace();

  assert.doesNotThrow(() => validatePlugins(paths));
});

test('generates endpoint-local plugin config files', () => {
  const paths = makeWorkspace();
  const generated = generatedPluginConfig(paths);

  assert.match(generated.backend, /BASE_PATH \. '\/plugins\/acme\/demo'/);
  assert.match(generated.backend, /'version' => '1.2.3'/);
  assert.match(generated.backend, /'defaults' => \[/);
  assert.match(generated.web, /import type \{ PluginRuntimeConfig \}/);
  assert.match(generated.web, /'acme.demo': \{/);
  assert.match(generated.web, /enabled: true/);
  assert.match(generated.web, /color: 'green'/);
  assert.doesNotMatch(generated.backend, /plugins\.config\.json|web\/config|web\/src\/plugins/);
  assert.doesNotMatch(generated.web, /plugins\.config\.json|backend\/config|backend\/plugins/);
});

test('sync writes generated plugin config files', () => {
  const paths = makeWorkspace();

  syncPluginConfig(paths);

  const generated = generatedPluginConfig(paths);
  assert.equal(fs.readFileSync(paths.backendPluginConfig, 'utf8'), generated.backend);
  assert.equal(fs.readFileSync(paths.webPluginConfig, 'utf8'), generated.web);
});

test('writePluginConfig sorts installed plugin ids', () => {
  const paths = makeWorkspace();

  writePluginConfig(
    {
      installed: {
        'zeta.demo': { source: 'plugins/zeta/demo' },
        'acme.demo': { source: 'plugins/acme/demo' },
      },
      disabled: [],
      config: {},
      marketplaces: [],
    },
    paths,
  );

  assert.deepEqual(Object.keys(readPluginConfig(paths).installed), ['acme.demo', 'zeta.demo']);
});
