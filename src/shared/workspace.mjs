import fs from 'node:fs';
import path from 'node:path';

export const findWorkspaceRoot = (start = process.cwd()) => {
  let current = path.resolve(start);

  while (true) {
    if (
      fs.existsSync(path.join(current, 'plugins.config.json')) ||
      (fs.existsSync(path.join(current, 'backend')) && fs.existsSync(path.join(current, 'web')))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Unable to find TrueAdmin workspace root.');
    }

    current = parent;
  }
};

export const workspacePaths = (root = findWorkspaceRoot()) => ({
  root,
  pluginConfig: path.join(root, 'plugins.config.json'),
  pluginSourceRoot: path.join(root, 'plugins'),
  backendRoot: path.join(root, 'backend'),
  backendPluginRuntimeRoot: path.join(root, 'backend/plugins'),
  backendPluginConfig: path.join(root, 'backend/config/autoload/plugins.php'),
  webRoot: path.join(root, 'web'),
  webPluginRuntimeRoot: path.join(root, 'web/src/plugins'),
  webPluginConfig: path.join(root, 'web/config/plugin.ts'),
});

export const relativePath = (root, value) => path.relative(root, value) || '.';
