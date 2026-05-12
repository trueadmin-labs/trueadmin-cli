import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDoctorCommand } from '../src/commands/doctor.mjs';
import { syncPluginConfig } from '../src/commands/plugin.mjs';

const makeWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trueadmin-doctor-'));
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

  fs.mkdirSync(path.join(root, 'plugins/acme/demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend/app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend/plugins/acme/demo'), { recursive: true });
  fs.mkdirSync(path.dirname(paths.backendPluginConfig), { recursive: true });
  fs.mkdirSync(path.join(root, 'web/src/plugins/acme/demo'), { recursive: true });
  fs.mkdirSync(path.dirname(paths.webPluginConfig), { recursive: true });
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
            defaults: {},
          },
        },
        disabled: [],
        config: {},
        marketplaces: [],
      },
      null,
      2,
    ),
  );
  syncPluginConfig(paths);

  return paths;
};

const captureDoctor = (paths) => {
  const originalLog = console.log;
  const previousExitCode = process.exitCode;
  const lines = [];
  process.exitCode = undefined;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    runDoctorCommand(paths);

    return {
      output: lines.join('\n'),
      exitCode: process.exitCode,
    };
  } finally {
    console.log = originalLog;
    process.exitCode = previousExitCode;
  }
};

test('doctor passes a healthy workspace', () => {
  const result = captureDoctor(makeWorkspace());

  assert.equal(result.exitCode, undefined);
  assert.doesNotMatch(result.output, /FAIL/);
  assert.match(result.output, /PASS workspace layout/);
  assert.match(result.output, /PASS generated plugin files/);
  assert.match(result.output, /PASS installed plugin runtime drift/);
  assert.match(result.output, /PASS runtime source boundaries/);
  assert.match(result.output, /PASS backend menu resource boundary/);
  assert.match(result.output, /PASS backend public permission boundary/);
  assert.match(result.output, /PASS backend admin middleware boundary/);
  assert.match(result.output, /PASS web manifest menu boundary/);
  assert.match(result.output, /PASS web env config boundary/);
});

test('doctor fails when generated plugin files are stale', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(paths.webPluginConfig, '// stale\n');

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL generated plugin files/);
  assert.match(result.output, /Run trueadmin plugin sync/);
});

test('doctor fails on cross-end runtime source references', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(path.join(paths.backendRoot, 'app/BadBoundary.php'), '<?php // web/config/plugin.ts' + '\n');

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL runtime source boundaries/);
  assert.match(result.output, /web\/config/);
});

test('doctor fails when web runtime reads env directly', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(path.join(paths.webRoot, 'src/BadEnv.ts'), 'export const value = import.meta.env.DEV;\n');

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL web env config boundary/);
  assert.match(result.output, /import\.meta\.env/);
});

test('doctor fails when backend controller declares menu attributes', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(path.join(paths.backendRoot, 'app/MenuController.php'), '<?php #[Menu(code: "bad")] final class MenuController {}' + '\n');

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend menu resource boundary/);
  assert.match(result.output, /#\[Menu/);
});

test('doctor fails when backend admin code uses public permissions', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.backendRoot, 'app/PublicPermissionController.php'),
    '<?php #[Permission(public: false)] final class PublicPermissionController {}' + '\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend public permission boundary/);
  assert.match(result.output, /Permission\(public: \.\.\.\)/);
});

test('doctor fails when admin permission middleware omits auth middleware', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.backendRoot, 'app/PermissionOnlyController.php'),
    '<?php #[AdminRouteController(path: "/bad", middleware: [PermissionMiddleware::class])] final class PermissionOnlyController { #[AdminGet("index")] public function index(): array { return []; } }' +
      '\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend admin middleware boundary/);
  assert.match(result.output, /PermissionMiddleware without AdminAuthMiddleware/);
});

test('doctor fails when admin permission middleware runs before auth middleware', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.backendRoot, 'app/ReversedMiddlewareController.php'),
    '<?php #[AdminRouteController(path: "/bad", middleware: [PermissionMiddleware::class, AdminAuthMiddleware::class])] final class ReversedMiddlewareController { #[AdminGet("index")] public function index(): array { return []; } }' +
      '\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend admin middleware boundary/);
  assert.match(result.output, /PermissionMiddleware before AdminAuthMiddleware/);
});

test('doctor fails when admin permission annotation has no permission middleware', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.backendRoot, 'app/MissingPermissionMiddlewareController.php'),
    '<?php #[AdminRouteController(path: "/bad", middleware: [AdminAuthMiddleware::class])] final class MissingPermissionMiddlewareController { #[Permission("bad.index")] #[AdminGet("index")] public function index(): array { return []; } }' +
      '\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend admin middleware boundary/);
  assert.match(result.output, /declares #\[Permission\] without class-level PermissionMiddleware/);
});

test('doctor fails when permission middleware is only declared on the method', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.backendRoot, 'app/MethodPermissionMiddlewareController.php'),
    '<?php #[AdminRouteController(path: "/ok", middleware: [AdminAuthMiddleware::class])] final class MethodPermissionMiddlewareController { #[Permission("ok.index")] #[AdminGet("index", middleware: [PermissionMiddleware::class])] public function index(): array { return []; } }' +
      '\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL backend admin middleware boundary/);
  assert.match(result.output, /without class-level PermissionMiddleware/);
});

test('doctor fails when plugin runtime drifts from source package', () => {
  const paths = makeWorkspace();
  fs.mkdirSync(path.join(paths.root, 'plugins/acme/demo/web'), { recursive: true });
  fs.writeFileSync(path.join(paths.root, 'plugins/acme/demo/web/manifest.ts'), 'export default { id: "acme.demo" };\n');
  fs.writeFileSync(path.join(paths.webPluginRuntimeRoot, 'acme/demo/manifest.ts'), 'export default { id: "acme.changed" };\n');

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL installed plugin runtime drift/);
  assert.match(result.output, /acme\.demo:web:changed manifest\.ts/);
});

test('doctor fails when web manifest declares menus', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.webPluginRuntimeRoot, 'acme/demo/manifest.ts'),
    'export default { id: "acme.demo", menus: [] };\n',
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL web manifest menu boundary/);
  assert.match(result.output, /manifest\.menus/);
});

test('doctor fails on latest npm dependencies and TrueAdmin composer repositories', () => {
  const paths = makeWorkspace();
  fs.writeFileSync(
    path.join(paths.webRoot, 'package.json'),
    JSON.stringify({ dependencies: { antd: 'latest' } }, null, 2),
  );
  fs.mkdirSync(path.join(paths.backendRoot), { recursive: true });
  fs.writeFileSync(
    path.join(paths.backendRoot, 'composer.json'),
    JSON.stringify(
      {
        repositories: {
          'trueadmin-kernel': {
            type: 'vcs',
            url: 'git@github.com:trueadmin-labs/trueadmin-kernel.git',
          },
        },
      },
      null,
      2,
    ),
  );

  const result = captureDoctor(paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL template package boundaries/);
  assert.match(result.output, /dependencies\.antd uses latest/);
  assert.match(result.output, /repositories contains TrueAdmin VCS/);
});
