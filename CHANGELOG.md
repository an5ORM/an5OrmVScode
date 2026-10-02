# Changelog

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

