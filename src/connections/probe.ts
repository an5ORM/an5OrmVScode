/** Isolated connection probe: credentials arrive via environment, never CLI arguments. */
import { createRequire } from 'module';
import * as path from 'path';

function loadAdapterModule(cwd: string): any {
  const rootReq = createRequire(path.join(cwd, 'package.json'));

  // 1. Direct workspace dependency
  try {
    return rootReq('@an5/adapters');
  } catch {
    // 2. Transitive dependency via @an5/orm (supports pnpm virtual store, yarn PnP, hoisted dependencies)
    try {
      const ormPkg = rootReq.resolve('@an5/orm');
      return createRequire(ormPkg)('@an5/adapters');
    } catch {
      try {
        const ormPkgJson = rootReq.resolve('@an5/orm/package.json');
        return createRequire(ormPkgJson)('@an5/adapters');
      } catch {
        // 3. Ambient fallback
        try {
          return require('@an5/adapters');
        } catch {
          throw new Error('Install @an5/adapters in this workspace to test a connection.');
        }
      }
    }
  }
}

function sanitizeError(err: unknown): string {
  if (!err) return 'Unknown connection error';
  let message = typeof err === 'object' && err !== null && 'message' in err && typeof (err as any).message === 'string'
    ? (err as any).message
    : String(err);
  return message
    .replace(/(:\/\/[^@/]*:)[^@]*@/g, '$1••••••••@')
    .replace(/((?:password|pwd|privateKey|apiKey|token|accessToken|refreshToken)=)[^;&\s]*/gi, '$1••••••••');
}

function safeIdent(name: string): string {
  const parts = name.split('.').map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.some(p => !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(p))) {
    throw new Error(`Invalid table or collection name "${name}".`);
  }
  return parts.join('.');
}

function quoteIdent(name: string, provider: string): string {
  return name.split('.').map(p => (
    provider === 'postgres' || provider === 'sqlite' ? `"${p}"` : provider === 'mssql' ? `[${p}]` : `\`${p}\``
  )).join('.');
}

async function fetchRows(adapter: any, table: string, provider: string): Promise<unknown[]> {
  try {
    const rows = await adapter.table(table).findMany({ take: 50 });
    if (Array.isArray(rows)) return rows;
  } catch { /* fall back to direct SELECT */ }
  const q = quoteIdent(table, provider);
  const sql = provider === 'mssql' ? `SELECT TOP 50 * FROM ${q}` : `SELECT * FROM ${q} LIMIT 50`;
  const res = await adapter.exec(sql, {});
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object' && Array.isArray((res as any).rows)) return (res as any).rows;
  return [];
}

function isVectorOnlyAdapter(adapter: any): boolean {
  // An5Adapter uses a Proxy that returns an AdapterTableClient for unknown property names,
  // so truthiness checks like `if (adapter.vectorStoreOnly)` are true on older @an5/adapters.
  return adapter?.vectorStoreOnly === true || adapter?.nbaseOnly === true;
}

async function runExplorerAction(adapter: any, rawReq: string): Promise<Record<string, unknown>> {
  const req = JSON.parse(rawReq) as { action: string; table?: string; row?: Record<string, unknown>; vector?: number[]; topK?: number };
  const provider = adapter.dialect || 'unknown';
  const vectorOnly = isVectorOnlyAdapter(adapter);
  if (req.action === 'tables') {
    if (vectorOnly) {
      const lister = adapter.$listCollections || adapter.listCollections;
      if (typeof lister === 'function') {
        const cols = await lister.call(adapter);
        const names = Array.isArray(cols) ? cols.map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean) : [];
        return { tables: names, provider };
      }
      return { tables: [], provider };
    }
    const sql = provider === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
      : provider === 'postgres'
        ? "SELECT table_schema AS schema_name, table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name"
        : provider === 'mysql'
          ? 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'
          : "SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME";
    const rows = await adapter.exec(sql, {});
    const tables = Array.isArray(rows) ? rows.map((r: any) => {
      const n = String(r?.name || r?.NAME || r?.table_name || r?.TABLE_NAME || '').trim();
      const s = String(r?.schema_name || r?.SCHEMA_NAME || r?.table_schema || r?.TABLE_SCHEMA || '').trim();
      if (!n) return '';
      if (s && s !== 'public' && s !== 'dbo') return `${s}.${n}`;
      return n;
    }).filter(Boolean) : [];
    return { tables, provider };
  }
  const table = safeIdent(String(req.table || '').trim());
  if (req.action === 'rows') {
    if (vectorOnly) {
      return { rows: [], provider, note: 'Use Vector Search to query vector-only stores.' };
    }
    const rows = await fetchRows(adapter, table, provider);
    return { rows, provider };
  }
  if (req.action === 'seed') {
    const created = await adapter.table(table).create({ data: req.row || {} });
    const rows = vectorOnly ? [created] : await fetchRows(adapter, table, provider);
    return { row: created, rows, provider };
  }
  if (req.action === 'vector') {
    const vector = Array.isArray(req.vector) ? req.vector.map(Number) : [];
    const topK = typeof req.topK === 'number' && req.topK > 0 ? Math.min(req.topK, 25) : 5;
    const rows = await adapter.table(table).vectorSearch({ vector, topK });
    return { rows: Array.isArray(rows) ? rows : [], provider };
  }
  throw new Error(`Unsupported explorer action "${req.action}".`);
}

async function main(): Promise<void> {
  let adapter: any;
  try {
    const mod = loadAdapterModule(process.cwd());
    adapter = mod.createAn5Adapter({ connectionString: process.env.DATABASE_URL, connectionTimeout: 10000, requestTimeout: 10000 });
    const started = Date.now();
    await adapter.$connect();
    if (process.env.AN5_EXPLORER_REQ) {
      const res = await runExplorerAction(adapter, process.env.AN5_EXPLORER_REQ);
      process.stdout.write(JSON.stringify({ ...res, latencyMs: Date.now() - started }));
      return;
    }
    if (isVectorOnlyAdapter(adapter)) {
      const health = typeof adapter.$vectorHealth === 'function' ? await adapter.$vectorHealth() : null;
      if (health && !health.ok) {
        throw new Error(health.error || `Vector store (${health.provider || adapter.dialect}) health check failed.`);
      }
      process.stdout.write(JSON.stringify({ latencyMs: Date.now() - started, provider: (health && health.provider) || adapter.dialect }));
    } else {
      await adapter.exec('SELECT 1 AS an5_connection_test', {});
      process.stdout.write(JSON.stringify({ latencyMs: Date.now() - started, provider: adapter.dialect }));
    }
  } catch (err) {
    process.stderr.write(sanitizeError(err));
    process.exitCode = 1;
  } finally {
    if (adapter) await adapter.$disconnect().catch(() => undefined);
  }
}
void main();
