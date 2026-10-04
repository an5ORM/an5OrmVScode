# Changelog

## [1.3.0] - 2026-10-04

- Resolve the TypeScript compiler from either a standalone checkout or the monorepo when building and packaging.

- Add editable project schema/client paths, guided connection presets, clearer storage choices and safer raw URI editing.
- Add Google Desktop OAuth setup/import, browser sign-in with PKCE and spreadsheet selection. Keep OAuth credentials in SecretStorage; desktop sign-in requires a local VS Code window.

- Rename MCP migration preview input to `preview` and forward `--preview` to the ORM; reject unsupported argument keys before running project commands.

- Add read-only `an5_generate_code` MCP tool supplying user-request context, workspace language, schema and generated APIs for the calling model.

### Changed
- Take every logo from the new `an5Brand` submodule, so this extension and the other AN5 repositories render the same organisation wordmark from one source of truth.
- Regenerate the icon set with the shared generator instead of a local copy. `npm run generate:icons` needs the submodule; `npm run check:icons` fails when a committed icon drifts from the brand tokens. Building and packaging the extension are unchanged, because the icons stay committed.
- Render the wordmark as vector outlines taken from a vendored font subset instead of a live `<text>` element. Font availability previously changed the letter weight per machine, so the SVGs disagreed with the PNGs rendered from them; rendering is now identical everywhere.
- Embolden the wordmark via the `wordmark.embolden` brand token, so the letters carry the weight of the original artwork.
- Derive the Connections webview theme colours from the same brand tokens, replacing five hardcoded hex literals with `var(--an5-gradient-*)`.
- `npm run check:icons` now also verifies the webview stylesheet carries the current token block.

### Fixed
- Use the rectangular organisation badge in the Activity Bar and the Connections editor tab, matching the Connections header and the Marketplace listing. This reverses the rounded square badge introduced in 1.1.3, which did not match the organisation wordmark.

## [1.2.0] - 2026-10-03

- Refresh the UI screenshot and replace broken Marketplace/Open VSX badge endpoints.

- Bundle an AN5 ORM agent skill and add project synchronization from the sidebar, Connections and Command Palette.
- Preserve user AGENTS.md conventions and refuse unmanaged skill conflicts or symlink writes.

## [1.1.4] - 2026-10-03

- Use the shared AN5 logo asset in the Connections workspace header.

## [1.1.3] - 2026-10-03

- Match the Activity Bar AN5 badge to the rounded square logo in Connections.

## [1.1.2] - 2026-10-03

### Fixed
- Automatically display the current project connection from environment/config, without manual import.
- Discover configured subprojects and follow the nearest project for the active editor.
- Refresh live source connections when config/env changes, and isolate environment variables while evaluating project configuration.
- Run tasks and MCP in the selected project, including nested projects.


## [1.1.1] - 2026-10-03

### Fixed
- Use the AN5 wordmark in the Activity Bar, with transparent letters that remain legible when VS Code applies its monochrome icon mask.


## [1.1.0] - 2026-10-03

### Added
- AN5 Activity Bar container with Connections, Schema Explorer and Project Actions.
- Connection manager webview: save/edit/delete, import from project settings, select an active profile and test database connectivity.
- Workspace-scoped profiles with credentials in VS Code SecretStorage, injected into AN5 tasks and extension-provided MCP only at launch.
- Model/field/relation navigation, workspace switching and configuration shortcuts.
- `an5.nodePath` to select a Node runtime for MCP and isolated connection probes.
- Connection, browser and real Extension Host regression coverage.

### Fixed
- Node runtime selection and Electron Node-mode fallback for MCP startup.
- Config refresh, `.env` parsing and `connectionString` fallback when DATABASE_URL is absent.
- Installed generator module loading, workspace selection, relation target normalization and nested schema discovery.
- Safe schema-file path containment; conservative SELECT validation and live table description using supported adapter APIs.
- Workspace command execution, argument forwarding and removal of automatic command retries.
- MCP generation honors language/output and rejects output paths or symlinks outside the workspace.
- Await asynchronous MCP tests and derive the MCP protocol version from the extension manifest.


## [1.0.6] - 2026-10-03

### Published
- The extension is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=an5orm.an5-orm-vscode)
  as well as [Open VSX](https://open-vsx.org/extension/an5orm/an5-orm-vscode). The id is the
  same on both, so `code --install-extension an5orm.an5-orm-vscode` works in VS Code and in
  VSCodium, which resolves it against Open VSX.

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
