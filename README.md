# an5OrmVScode

<p align="center">
  <img src="icons/an5-128x128.png" width="96" height="96" alt="AN5 ORM Logo" />
</p>

VS Code extension for AN5 ORM schema files. Provides syntax highlighting, formatting, status bar commands, and tooling for `an5Orm.config.js` and `.an5` files.

## Features

- **Syntax highlighting** — Color-coded model definitions, fields, attributes
- **Auto-formatting** — Align fields, types, and attributes
- **Snippets** — Quick code completion for common patterns
- **MCP server** — Exposes the AN5 ORM to agentic clients such as GitHub Copilot

## MCP server (GitHub Copilot, Cursor, Claude Desktop)

The extension ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so agentic clients can inspect your AN5 schema, run read-only queries
and drive schema operations instead of guessing at your data model.

On VS Code 1.101 or newer the server registers itself: open `MCP: List Servers`
and start **AN5 ORM**. Nothing to copy, and no config file to edit.

If it does not appear — an older build, or an editor such as Cursor or VSCodium
that predates the API — run **AN5: Install MCP Server** from the Command Palette
(or click the status bar item and pick it). It writes the entry into the open
workspace for you, with the extension path already resolved:

- `.mcp.json` — the portable format, read by VS Code and other agent tools
- `.vscode/mcp.json` — the VS Code format

Your other servers and the rest of the file are left alone, running it twice
changes nothing, and a file it cannot parse is reported rather than overwritten.

The server is started with the editor's own Node binary rather than `node` from
`PATH`, so a version-manager install works the same as a system one.

To see the resolved configuration without writing it, run
**AN5: Show MCP Server Configuration**.

For another MCP client, point it at the server shipped in the installed
extension — the paths `AN5: Show MCP Server Configuration` prints are the ones to
use. The server is discoverable from there, not from `node_modules`: this
extension is installed from the marketplace, not from npm.

The server discovers the project from its working directory: it reads
`an5Orm.config.js`, finds the `.an5` files, uses the installed `@an5/orm` for
generate/push/pull/migrate/seed, and connects with `DATABASE_URL` from the
environment or the project `.env`.

### Tools

Read-only tools are marked `readOnlyHint`, so VS Code runs them without asking
for confirmation.

| Tool | What it does |
|------|--------------|
| `an5_list_models` | List every model, its table, and field/relation counts |
| `an5_describe_model` | Fields with SQL type, keys, defaults, and relations |
| `an5_get_relations` | Relation graph with foreign/local key columns |
| `an5_analyze_schema` | Missing keys, unindexed foreign keys, unique candidates |
| `an5_read_schema_file` | Raw contents of a `.an5` file (workspace-scoped) |
| `an5_query_database` | Run a `SELECT`; other statements are rejected |
| `an5_describe_table` | Table columns from the schema, else from the database |
| `an5_database_health` | Connectivity and latency check |

These tools change the database or write files. They are not marked read-only,
so VS Code shows a confirmation dialog, **and** they require an explicit
`confirm: true` argument so a model cannot trigger them on its own.

| Tool | What it does |
|------|--------------|
| `an5_generate_client` | Generate client code for TypeScript/Python/.NET/Go/Rust |
| `an5_push_schema` | Create tables and missing columns from the schema |
| `an5_pull_schema` | Introspect the database into `.an5` files |
| `an5_migrate` | `diff`, `generate`, `apply`, `rollback`, `status` |
| `an5_seed` | Insert the ORM seed data |


## Installation

### From the Marketplace

```bash
code --install-extension an5orm.an5-orm-vscode
```

### From a VSIX

```bash
code --install-extension an5-orm-vscode-<version>.vsix
```

Build one with `npm run package`.

### From Source

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Usage

Open any `.an5` file to get syntax highlighting and formatting.

### Schema Syntax

```an5
model User {
  id        NVARCHAR(255) @id @default(uuid())
  email     NVARCHAR(255) @unique
  name      NVARCHAR(255)?
  createdAt DATETIME2     @default(now())
  orders    Order[]

  @@map("users")
}
```

### Formatting

Press `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (Mac) to format the document.

**Before:**
```an5
model User {
id NVARCHAR(255) @id @default(uuid())
email NVARCHAR(255) @unique
name NVARCHAR(255)?
createdAt DATETIME2 @default(now())
}
```

**After:**
```an5
model User {
  id        NVARCHAR(255) @id @default(uuid())
  email     NVARCHAR(255) @unique
  name      NVARCHAR(255)?
  createdAt DATETIME2     @default(now())
}
```

### Snippets

Type the prefix and press `Tab` to expand:

| Prefix | Expansion |
|--------|-----------|
| `model` | Full model block |
| `@description` | `@description("...")` |
| `@@description` | `@@description("...")` |
| `@id` | `@id @default(uuid())` |
| `@unique` | `@unique` |
| `@default` | `@default(...)` |
| `@relation` | `@relation(fields: [], references: [])` |
| `@@map` | `@@map("tableName")` |
| `@@unique` | `@@unique([field1, field2])` |
| `@@index` | `@@index([field1, field2])` |

## Development

```bash
# Compile
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Package VSIX bundle
npm run package

# Publish to VS Code Marketplace
npm run publish:marketplace -- -p <VSCE_PAT_TOKEN>

# Publish to Open VSX Registry
npm run publish:openvsx -- -p <OVSX_PAT_TOKEN>
```

## Testing

```bash
# Smoke test
node test/smoke.test.js

# Snippets test
node test/snippets.test.js

# Grammar test
node test/grammar.test.js
# MCP server, definition and config merge
node test/mcp.test.js
```

## License

MIT

## Automated releases

Pull requests and pushes to `main` run a clean install, build, tests and VSIX packaging.
To release, update `package.json` and `package-lock.json` to a new stable version,
add its entry to `CHANGELOG.md`, then push to `main`. CI creates `v<version>`
and a GitHub Release with the tested VSIX attached. An existing version on a
different commit is left alone. Version tags and manual workflow runs also work.

Open VSX publishing uses the same tested VSIX and the repository Actions secret
`OVSX_PAT`. It publishes automatically when that secret is configured.

### VS Code Marketplace (manual upload, no Azure billing)

Marketplace publishing uses your browser login, without `VSCE_PAT` or an Azure
subscription. After GitHub creates the release:

1. Download `an5-orm-vscode-<version>.vsix` from the
   [GitHub Release](https://github.com/an5ORM/an5OrmVScode/releases).
2. Open [publisher an5orm](https://marketplace.visualstudio.com/manage/publishers/an5orm).
3. Select **More Actions → Update** for AN5 ORM Schema Tooling.
4. Choose the downloaded VSIX and click **Upload**.
5. Wait for verification and confirm the new version on the
   [public Marketplace page](https://marketplace.visualstudio.com/items?itemName=an5orm.an5-orm-vscode).

The workflow summary includes direct release and VSIX download links. CI does not
publish to the VS Code Marketplace automatically. A missing `VSCE_PAT` never
fails this workflow. Do not commit tokens or pass them in command-line arguments.
