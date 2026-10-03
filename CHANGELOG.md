# Changelog

## [1.0.6] - 2026-10-03

### Fixed
- **The MCP server never appeared in `MCP: List Servers`** — it was constructed with an
  options object, but `McpStdioServerDefinition` takes positional arguments. `label` was
  left holding an object and `command` undefined; VS Code validates that on its own
  schedule, so the failure was swallowed and neither the server nor an error reached the
  user. Registering the server was the documented path and it had never worked, which
  left installing it as manual copy-paste.
- **The server was missing from any workspace without an AN5 project** — extension-provided
  MCP servers exist only once the extension activates, and it activated on
  `workspaceContains` alone.
- **The documented install command named a file that does not exist** — the README pointed
  at a pinned `an5-orm-vscode-1.0.2.vsix` rather than the published extension id, and told
  users to run a path under `node_modules` although the extension is not published to npm.

### Added
- `AN5: Install MCP Server` writes the entry into the open workspace with the extension
  path already resolved, as `.mcp.json` (portable) or `.vscode/mcp.json`. Other servers and
  the rest of the file are preserved, running it twice changes nothing, and a file it cannot
  parse is reported rather than overwritten.
- Both MCP commands are reachable from the status bar item, not only the Command Palette.

### Changed
- The server is started with the editor's own Node binary instead of `node` from `PATH`,
  which the editor does not pass on, so a version-manager install works.
- `cwd` is set from the folder VS Code asks about, and a folder opened after activation is
  picked up, so multi-root and late-opened folders are no longer served a stale directory.
- The server version is read from the manifest instead of a constant that had drifted to
  `1.0.2`, so VS Code notices when the tools change.

## [1.0.5] - 2026-10-02

### Fixed
- **A workspace schema for PostgreSQL or SQLite was reported as broken** — `@an5/orm`
  validates field types per provider and defaults to SQL Server when none is passed, so
  every MCP tool saw a valid schema as one full of unknown types. The provider is now
  read from the project config, guarded, because the extension locates the ORM in the
  workspace at runtime rather than depending on it.

## [1.0.4] - 2026-09-28

- fix(mcp): keep `@description` on relations. The schema reader captured
  descriptions on models and fields but dropped the one declared on a relation
  line, so `an5_describe_model` and `an5_get_relations` lost that text.

## [1.0.3] - 2026-09-28

- feat(mcp): ship a Model Context Protocol server so GitHub Copilot and other
  agentic clients can explore the AN5 schema, run read-only queries and drive
  generate/push/pull/migrate. Read-only tools carry `readOnlyHint`; every
  mutating tool additionally requires an explicit `confirm: true` argument.
- feat: `AN5: Show MCP Server Configuration` command for clients that need a
  hand-written `mcp.json` entry.
- BREAKING: raise the minimum VS Code version to 1.101, which is where
  `vscode.lm.registerMcpServerDefinitionProvider` is available.

## [1.0.2] - 2026-08-19

- chore: update official AN5 gradient badge icon styling across all sizes
- fix: pixel-perfect centering and corner radius for extension icons
- build: compile and package extension for release

## [1.0.1] - 2026-07-05

- chore: update changes and command contributions

## [1.0.0] - 2026-07-04

- Initial release

