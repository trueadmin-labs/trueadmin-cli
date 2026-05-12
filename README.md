# TrueAdmin CLI

Framework-level CLI for TrueAdmin.

The CLI manages cross-end framework tasks such as plugin installation, plugin config distribution, and workspace doctor checks. Runtime applications consume generated files inside their own end directories instead of reading cross-end configuration directly.

## Usage

```bash
npx trueadmin --version
npx trueadmin --help
npx trueadmin init my-admin
cd my-admin
npm install
pnpm --dir web install
composer --working-dir=backend install
cp .env.example .env
cp backend/.env.example backend/.env
docker compose -f deploy/docker/docker-compose.yml up -d
php backend/bin/hyperf.php migrate:fresh --seed
npm run doctor
```

## Boundary Model

- `plugins.config.json` is framework-level input and is only read by the TrueAdmin CLI.
- Backend runtime reads `backend/config/autoload/plugins.php` and `backend/plugins/**`.
- Web runtime reads `web/config/plugin.ts` and `web/src/plugins/**`.
- `trueadmin doctor` checks generated files, installed runtimes, cross-end config boundary violations, backend menu resource boundaries, and Web env access boundaries.
