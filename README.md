# mssqlOrmVScode

VS Code extension for MSSQL ORM schema files. Provides syntax highlighting, formatting, and snippets for `.mssql` files.

## Features

- **Syntax highlighting** — Color-coded model definitions, fields, attributes
- **Auto-formatting** — Align fields, types, and attributes
- **Snippets** — Quick code completion for common patterns

## Installation

### From VSIX

```bash
code --install-extension mssql-orm-vscode-1.0.1.vsix
```

### From Source

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Usage

Open any `.mssql` file to get syntax highlighting and formatting.

### Schema Syntax

```mssql
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
```mssql
model User {
id NVARCHAR(255) @id @default(uuid())
email NVARCHAR(255) @unique
name NVARCHAR(255)?
createdAt DATETIME2 @default(now())
}
```

**After:**
```mssql
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

# Package VSIX
vsce package
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
