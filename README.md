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

On VS Code 1.101 or newer the server registers itself; open
`MCP: List Servers` and look for **AN5 ORM**. On older versions, run
**AN5: Show MCP Server Configuration** and paste the result into
`.vscode/mcp.json`.

```json
{
  "servers": {
    "an5-orm": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-extension>/dist/mcp/server.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

For other MCP clients, run the server directly:

```bash
node node_modules/an5-orm-vscode/dist/mcp/server.js
```

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

### From VSIX

```bash
code --install-extension an5-orm-vscode-1.0.2.vsix
```

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
```

## License

MIT
