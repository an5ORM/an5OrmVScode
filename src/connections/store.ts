import { createHash, randomBytes } from 'crypto';

export interface ConnectionProfile { id: string; name: string; provider: string; project?: boolean; source?: string }
export interface ConnectionState { profiles: ConnectionProfile[]; activeId?: string }
interface StateStore { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): Thenable<void> }
interface Secrets { get(key: string): Thenable<string | undefined>; store(key: string, value: string): Thenable<void>; delete(key: string): Thenable<void> }
export function providerOf(value: string): string {
  const cs = value.trim();
  if (/^postgres(?:ql)?:\/\//i.test(cs)) return 'postgres';
  if (/^(?:mysql|mariadb):\/\//i.test(cs)) return 'mysql';
  if (/^(sqlite:|:memory:$)/i.test(cs) || /\.(sqlite|sqlite3|db)$/i.test(cs)) return 'sqlite';
  if (/^(mssql|sqlserver):\/\//i.test(cs) || /(?:^|;)\s*(server|data source)\s*=/i.test(cs)) return 'mssql';
  if (/^googlesheets:\/\//i.test(cs)) return 'googlesheets';
  if (/^nbase:\/\//i.test(cs)) return 'nbase';
  throw new Error('Use a SQL Server, PostgreSQL, MySQL, SQLite, Google Sheets or NBase connection string.');
}

/** Metadata belongs to the workspace; connection strings only belong to SecretStorage. */
export class ConnectionStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly state: StateStore, private readonly secrets: Secrets) {}
  private key(root: string): string { return `an5.connections.${createHash('sha256').update(root).digest('hex')}`; }
  private secretKey(root: string, id: string): string { return `${this.key(root)}.${id}`; }
  list(root: string): ConnectionState { return this.state.get(this.key(root), { profiles: [] }); }
  private change<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run); this.queue = next.catch(() => undefined); return next;
  }
  async secret(root: string, id?: string): Promise<string | undefined> {
    const current = this.list(root); const selected = id ?? current.activeId;
    if (!selected || !current.profiles.some(p => p.id === selected)) return undefined;
    return this.secrets.get(this.secretKey(root, selected));
  }
  save(root: string, name: string, connectionString: string, id?: string): Promise<ConnectionProfile> {
    return this.change(async () => {
      const current = this.list(root);
      if (id && !current.profiles.some(p => p.id === id)) throw new Error('Connection no longer exists.');
      const cleanName = name.trim();
      if (!cleanName || cleanName.length > 80 || /[\r\n]/.test(cleanName)) throw new Error('Enter a connection name of 1–80 characters.');
      if (current.profiles.some(p => p.id !== id && p.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('A connection with this name already exists.');
      const value = connectionString.trim() || (id ? await this.secret(root, id) : undefined);
      if (!value) throw new Error('Enter a connection string.');
      if (/[\r\n\0]/.test(value)) throw new Error('Connection string must be a single line.');
      const profile = { id: id || randomBytes(16).toString('hex'), name: cleanName, provider: providerOf(value) };
      const key = this.secretKey(root, profile.id);
      const previous = await this.secrets.get(key);
      await this.secrets.store(key, value);
      try {
        await this.state.update(this.key(root), { ...current, profiles: [...current.profiles.filter(p => p.id !== profile.id), profile] });
      } catch (error) {
        if (previous !== undefined) await this.secrets.store(key, previous); else await this.secrets.delete(key);
        throw error;
      }
      return profile;
    });
  }
  activate(root: string, id?: string): Promise<void> {
    return this.change(async () => {
      const current = this.list(root);
      if (id && !current.profiles.some(p => p.id === id)) throw new Error('Connection no longer exists.');
      if (id && !await this.secret(root, id)) throw new Error('Saved credentials are unavailable. Edit the connection to enter them again.');
      await this.state.update(this.key(root), { profiles: current.profiles, ...(id ? { activeId: id } : {}) });
    });
  }
  remove(root: string, id: string): Promise<void> {
    return this.change(async () => {
      const current = this.list(root);
      await this.state.update(this.key(root), { profiles: current.profiles.filter(p => p.id !== id), ...(current.activeId && current.activeId !== id ? { activeId: current.activeId } : {}) });
      await this.secrets.delete(this.secretKey(root, id));
    });
  }
}
