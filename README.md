# TrueAdmin CLI

Framework-level CLI for TrueAdmin.

The CLI manages cross-end framework tasks such as plugin installation, plugin config distribution, and workspace doctor checks. Runtime applications consume generated files inside their own end directories instead of reading cross-end configuration directly.

## Boundary Model

- `plugins.config.json` is framework-level input and is only read by the TrueAdmin CLI.
- Backend runtime reads `backend/config/autoload/plugins.php` and `backend/plugins/**`.
- Web runtime reads `web/config/plugin.ts` and `web/src/plugins/**`.
- `trueadmin doctor` checks generated files, installed runtimes, and cross-end config boundary violations.
