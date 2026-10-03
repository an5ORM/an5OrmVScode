---
name: an5-orm
description: Develop AN5 ORM projects using .an5 schemas, generated clients, queries, adapters and the AN5 MCP server. Use when changing AN5 models, relations, database access or ORM configuration.
---
<!-- Managed by AN5 ORM extension. Edit project conventions in AGENTS.md outside the AN5 section. -->

Read the nearest project's `an5Orm.config.js` or `.cjs`, `package.json` scripts and `.an5` schema files before choosing commands. In a monorepo, work from the relevant child project. Preserve the configured provider, output paths, metadata settings and generation targets.

## Schema and clients

Treat `.an5` schemas as the source of truth for generated models. Inspect existing types, primary keys, relations, indexes and table mappings before editing. Regenerate the affected client using the project's `generate` script or AN5 extension command; avoid hand edits to generated files that regeneration would discard. Read the generated client API rather than assuming Prisma or another ORM's method signatures.

## Connections and adapters

Connections can come from `DATABASE_URL`, the project's `.env`, or `connectionString` in its config. The extension can override this with an active SecretStorage profile for commands and its MCP server. A shell or manually configured MCP server may therefore use a different connection. Verify the intended project/provider before a database operation. Keep credentials out of instructions, logs, committed files and tool output. SQLite relative paths belong to the selected project.

Use the project's installed `@an5/adapters` and existing connection lifecycle. Check supported transactions, parameter syntax and provider-specific behavior before adapting a query. Prefer parameterized SQL. Close connections created for probes/tests.

## MCP and commands

When AN5 MCP tools are available, use `an5_list_models`, `an5_describe_model`, `an5_get_relations`, `an5_analyze_schema` and `an5_read_schema_file` to inspect the schema. `an5_query_database` is SELECT-only; use limited results and parameters supported by its input schema. `an5_describe_table` and `an5_database_health` inspect the configured database.

Inspect each tool's actual input schema. Client generation, schema push/pull, seed and mutating migration operations require `confirm: true`; set it only when the requested operation is authorized. Existing user authorization remains valid. Generating a client does not imply permission to push its schema to a database.

Prefer existing npm scripts (`generate`, `db:push`, `db:pull`, `db:migrate:*`, `db:seed`) and extension commands. Do not invent an `npx an5` fallback if the package does not provide that executable. If the runnable entry point or connection is missing, report the specific missing prerequisite.

Validate changes with the project's relevant build/tests and explain schema/client/database effects. Use a disposable database for tests unless another target is explicitly authorized.
