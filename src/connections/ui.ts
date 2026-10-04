import * as vscode from 'vscode';
import { syncAgentSkills } from '../agent-skills';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { projectConnection, projectRoots } from './project';
import { ConnectionStore, ConnectionProfile, providerOf } from './store';
import { nodeRuntime } from '../node-runtime';
import { testConnection, normalizeConnectionString } from './runtime';
import { saveConnectionToEnv, saveConnectionToConfig } from './project-writer';
import { resolveWorkspace } from '../mcp/workspace';
import { projectSettings, saveProjectSettings } from './project-settings';
import { authorizeGoogle, GoogleClient, googleConnection, googleSpreadsheets, parseGoogleClient } from './google-oauth';

interface Entry { root: vscode.WorkspaceFolder; profile?: ConnectionProfile; action?: string }

export class ConnectionUi implements vscode.TreeDataProvider<Entry>, vscode.Disposable {
  readonly store: ConnectionStore;
  private readonly events = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this.events.event;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private panel?: vscode.WebviewPanel;
  private folder?: vscode.WorkspaceFolder;
  private selectedId?: string;
  private configureMode = false;
  private busy = false;
  private projectCache?: vscode.WorkspaceFolder[];
  private readonly statuses = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new ConnectionStore(context.workspaceState, context.secrets);
    this.disposables.push(vscode.window.createTreeView('an5.connections', { treeDataProvider: this, showCollapseAll: true }));
    const actions = [
      ['Manage connections', 'an5.connections.manage', 'database'], ['Open ORM configuration', 'an5.openConfig', 'settings-gear'],
      ['Generate client', 'an5.generate', 'gear'], ['Push schema', 'an5.push', 'cloud-upload'],
      ['Pull schema', 'an5.pull', 'cloud-download'], ['Configure MCP', 'an5.mcp.install', 'robot'],
      ['Sync agent skills', 'an5.agentSkills.sync', 'book'],
      ['MCP servers', 'workbench.mcp.listServer', 'list-unordered'],
    ].map(([label, command, icon]) => { const item = new vscode.TreeItem(label); item.iconPath = new vscode.ThemeIcon(icon); item.command = { command, title: label }; return item; });
    this.disposables.push(vscode.window.registerTreeDataProvider('an5.actions', { getTreeItem: item => item, getChildren: () => actions }));
    this.disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh()));
    const commands: Record<string, (...args: any[]) => unknown> = {
      'an5.agentSkills.sync': async (target?: vscode.WorkspaceFolder) => {
        this.requireTrust();
        const folder = target || await this.pickFolder();
        if (!folder) return;
        try {
          const changed = syncAgentSkills(folder.uri.fsPath, this.context.extensionPath);
          vscode.window.showInformationMessage(changed.length ? `AN5 agent skills synced to ${folder.name}.` : 'AN5 agent skills are already up to date.');
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'AGENTS.md')));
        } catch (error) { vscode.window.showErrorMessage((error as Error).message); }
      },
      'an5.connections.manage': (entry?: Entry) => this.open(entry),
      'an5.connections.configure': (entry?: Entry) => this.open(entry, true),
      'an5.connections.add': () => this.open(undefined, true),
      'an5.connections.refresh': () => this.refresh(),
      'an5.connections.test': (entry: Entry) => this.test(entry),
      'an5.connections.use': (entry: Entry) => this.use(entry),
      'an5.connections.remove': (entry: Entry) => this.remove(entry),
    };
    for (const [name, callback] of Object.entries(commands)) {
      this.disposables.push(vscode.commands.registerCommand(name, async (...args) => {
        try { return await callback(...args); } catch { vscode.window.showErrorMessage('AN5: Operation failed. Please retry.'); }
      }));
    }
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { this.projectCache = undefined; this.folder = (vscode.window.activeTextEditor && this.projectFor(vscode.window.activeTextEditor.document.uri)) || this.projects()[0]; this.selectedId = undefined; if (!this.folder) this.panel?.dispose(); this.refresh(); }));
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
      const folder = editor && this.projectFor(editor.document.uri);
      if (folder && this.folder && folder.uri.toString() !== this.folder.uri.toString()) { this.folder = folder; this.selectedId = undefined; this.refresh(); }
    }));
    const watcher = vscode.workspace.createFileSystemWatcher('**/{an5Orm.config.js,an5Orm.config.cjs,.env,*.an5}');
    this.disposables.push(watcher, watcher.onDidChange(() => { this.statuses.clear(); this.refresh(); }), watcher.onDidCreate(() => this.refresh()), watcher.onDidDelete(() => { this.statuses.clear(); this.refresh(); }));
    this.disposables.push(context.secrets.onDidChange(() => this.refresh()));
  }
  dispose(): void { this.panel?.dispose(); this.events.dispose(); this.changed.dispose(); this.disposables.forEach(d => d.dispose()); }
  refresh(): void { this.projectCache = undefined; this.events.fire(undefined); this.changed.fire(); void this.renderState(); }
  getTreeItem(entry: Entry): vscode.TreeItem {
    if (!entry.profile && !entry.action) {
      const item = new vscode.TreeItem(entry.root.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('root-folder'); return item;
    }
    if (entry.action) {
      const isConfigure = entry.action === 'configure';
      const item = new vscode.TreeItem(isConfigure ? 'Configure project connection' : 'Manage connections');
      item.iconPath = new vscode.ThemeIcon(isConfigure ? 'plug' : 'settings-gear');
      item.command = isConfigure
        ? { command: 'an5.connections.configure', title: 'Configure project connection', arguments: [entry] }
        : { command: 'an5.connections.manage', title: 'Manage connections', arguments: [entry] };
      return item;
    }
    const profile = entry.profile!;
    const activeId = this.store.list(entry.root.uri.toString()).activeId;
    const active = activeId ? activeId === profile.id : !!profile.project;
    const item = new vscode.TreeItem(profile.name);
    item.description = `${profile.provider}${active ? ' · active' : ''}`;
    item.iconPath = new vscode.ThemeIcon(active ? 'plug' : 'database');
    item.contextValue = profile.project ? 'an5ProjectConnection' : 'an5Connection';
    item.tooltip = `${profile.name} (${profile.provider})${active ? '\nUsed by AN5 commands and extension-provided MCP.' : ''}`;
    item.command = { command: 'an5.connections.manage', title: 'Manage connection', arguments: [entry] }; return item;
  }
  getChildren(entry?: Entry): Entry[] {
    if (!entry) return this.projects().map(root => ({ root }));
    if (entry.profile || entry.action) return [];
    const profiles = this.profiles(entry.root);
    return [...profiles.map(profile => ({ root: entry.root, profile })), ...(!profiles.some(p => p.project) ? [{ root: entry.root, action: 'configure' }] : []), { root: entry.root, action: 'manage' }];
  }
  private profiles(folder: vscode.WorkspaceFolder): ConnectionProfile[] {
    const saved = this.store.list(folder.uri.toString()).profiles;
    const project = vscode.workspace.isTrusted ? projectConnection(folder.uri.fsPath) : undefined;
    return project ? [project.profile, ...saved] : saved;
  }
  projects(): vscode.WorkspaceFolder[] {
    if (!this.projectCache) {
      this.projectCache = (vscode.workspace.workspaceFolders || []).flatMap(folder => projectRoots(folder.uri.fsPath).map(root => ({
        uri: vscode.Uri.joinPath(folder.uri, ...path.relative(folder.uri.fsPath, root).split(path.sep).filter(Boolean)),
        name: root === folder.uri.fsPath ? folder.name : `${folder.name} / ${path.relative(folder.uri.fsPath, root)}`,
        index: folder.index,
      })));
    }
    return this.projectCache;
  }
  private projectFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return [...this.projects()].sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length).find(folder => {
      if (folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return false;
      const relative = path.relative(folder.uri.fsPath, uri.fsPath);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
  }
  async pickFolder(preferActive = true): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = this.projects();
    if (!folders.length) { vscode.window.showInformationMessage('Open a workspace folder to manage AN5 connections.'); return undefined; }
    const active = vscode.window.activeTextEditor && this.projectFor(vscode.window.activeTextEditor.document.uri);
    if (preferActive && active) return active;
    if (preferActive && this.folder && folders.some(f => f.uri.toString() === this.folder!.uri.toString())) return this.folder;
    if (folders.length === 1) return folders[0];
    const choice = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { placeHolder: 'Select the AN5 project' });
    return choice?.folder;
  }
  async environment(folder: vscode.WorkspaceFolder): Promise<Record<string, string>> {
    const connectionString = await this.store.secret(folder.uri.toString());
    if (this.store.list(folder.uri.toString()).activeId && !connectionString) throw new Error('Active connection credentials are missing. Edit the connection before running commands.');
    const value = connectionString || (vscode.workspace.isTrusted ? projectConnection(folder.uri.fsPath)?.connectionString : undefined);
    return value ? { DATABASE_URL: normalizeConnectionString(folder.uri.fsPath, value) } : {};
  }
  private requireTrust(): void {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before loading configuration or connecting.');
  }
  private async open(entry?: Entry, add = false): Promise<void> {
    const folder = entry?.root || (vscode.window.activeTextEditor && this.projectFor(vscode.window.activeTextEditor.document.uri)) || this.folder || await this.pickFolder();
    if (!folder) return;
    this.folder = folder; this.selectedId = add ? undefined : entry?.profile?.id;
    this.configureMode = add || entry?.action === 'configure';
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('an5.connectionManager', 'AN5 · Connections', vscode.ViewColumn.One, {
        enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), vscode.Uri.joinPath(this.context.extensionUri, 'icons')],
      });
      this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'icons', 'activity.svg');
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage(message => this.message(message));
    } else this.panel.reveal();
    await this.renderState();
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'icons', 'an5-64x64.svg'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'connections.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'connections.js'));
    return fs.readFileSync(path.join(this.context.extensionUri.fsPath, 'media', 'connections.html'), 'utf8')
      .replace(/__CSP__/g, webview.cspSource).replace(/__NONCE__/g, nonce).replace('__LOGO__', String(logo)).replace('__CSS__', String(css)).replace('__SCRIPT__', String(script));
  }
  private async renderState(): Promise<void> {
    if (!this.panel || !this.folder) return;
    const folder = this.folder;
    const state = this.store.list(folder.uri.toString());
    const configPath = ['an5Orm.config.js', 'an5Orm.config.cjs'].find(name => fs.existsSync(path.join(folder.uri.fsPath, name)));
    const settings = vscode.workspace.isTrusted ? projectSettings(resolveWorkspace(folder.uri.fsPath).config) : undefined;
    const googleConfigured = !!await this.context.secrets.get(this.googleClientKey(folder));
    await this.panel.webview.postMessage({ type: 'state', workspace: folder.name, root: folder.uri.fsPath, configPath,
      trusted: vscode.workspace.isTrusted, settings, googleConfigured, googleLocal: !vscode.env.remoteName, selectedId: this.selectedId, configureMode: this.configureMode, activeId: state.activeId || (this.profiles(folder).some(p => p.project) ? 'project' : undefined), busy: this.busy,
      profiles: this.profiles(folder).map(p => ({ ...p, status: this.statuses.get(`${folder.uri.toString()}:${p.id}`) })) });
  }
  private async message(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !this.folder) return;
    const m = message as Record<string, unknown>;
    if (m.type === 'ready') { await this.renderState(); return; }
    if (typeof m.root === 'string' && m.root !== this.folder.uri.fsPath) { this.notify('The selected project changed. Review this project before saving.', true); await this.renderState(); return; }
    if (this.busy) return;
    this.busy = true;
    const folder = this.folder;
    try {
      await this.renderState();
      const root = folder.uri.toString();
      const id = typeof m.id === 'string' ? m.id : undefined;
      const profile = id ? this.profiles(folder).find(p => p.id === id) : undefined;
      const entry = { root: folder, profile };
      switch (m.type) {
        case 'googleHelp': await vscode.env.openExternal(vscode.Uri.parse('https://developers.google.com/identity/protocols/oauth2/native-app')); break;
        case 'googleSaveClient': {
          this.requireTrust();
          const client = parseGoogleClient({ installed: { client_id: m.clientId, client_secret: m.clientSecret } });
          await this.context.secrets.store(this.googleClientKey(folder), JSON.stringify(client));
          this.notify('Google OAuth application configured. You can now sign in and choose a spreadsheet.');
          void this.panel?.webview.postMessage({ type: 'googleConfigured' });
          break;
        }
        case 'googleConfigure': {
          this.requireTrust();
          const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Google OAuth client JSON': ['json'] }, openLabel: 'Import desktop OAuth client' });
          if (!uris?.[0]) break;
          let client: GoogleClient;
          try { client = parseGoogleClient(JSON.parse(fs.readFileSync(uris[0].fsPath, 'utf8'))); }
          catch { throw new Error('Select the downloaded OAuth client JSON for a Google Desktop app.'); }
          await this.context.secrets.store(this.googleClientKey(folder), JSON.stringify(client));
          this.notify('Google OAuth application imported. Sign in to choose a spreadsheet.');
          void this.panel?.webview.postMessage({ type: 'googleConfigured' });
          break;
        }
        case 'googleSignIn': {
          this.requireTrust();
          if (vscode.env.remoteName) throw new Error('Desktop Google sign-in requires a local VS Code window. Configure this application locally; remote projects can use a service account.');
          const stored = await this.context.secrets.get(this.googleClientKey(folder));
          if (!stored) throw new Error('Configure a Google Desktop OAuth application first.');
          const client = JSON.parse(stored) as GoogleClient;
          const tokens = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'AN5: Sign in with Google in your browser', cancellable: true }, async (_progress, cancellation) => {
            const controller = new AbortController();
            const listener = cancellation.onCancellationRequested(() => controller.abort());
            const disposed = this.panel?.onDidDispose(() => controller.abort());
            try { return await authorizeGoogle(client, async url => await vscode.env.openExternal(vscode.Uri.parse(url)), controller.signal); }
            finally { listener.dispose(); disposed?.dispose(); }
          });
          const sheets = await googleSpreadsheets(tokens);
          if (!sheets.length) throw new Error('No spreadsheets found in this account. Create or share a spreadsheet, then reconnect.');
          const chosen = await vscode.window.showQuickPick(sheets.map(sheet => ({ label: sheet.name, description: sheet.id, sheet })), { placeHolder: 'Choose a Google spreadsheet for this AN5 project', matchOnDescription: true });
          if (!chosen) break;
          const current = this.store.list(root).profiles;
          let existing: ConnectionProfile | undefined;
          for (const candidate of current.filter(p => p.provider === 'googlesheets')) {
            if ((await this.store.secret(root, candidate.id))?.startsWith(`googlesheets://${chosen.sheet.id};`)) { existing = candidate; break; }
          }
          const requestedName = typeof m.name === 'string' ? m.name.trim() : '';
          const base = requestedName || `${chosen.sheet.name.slice(0, 55)} · Google Sheets`;
          let name = existing?.name || base, suffix = 2;
          while (!existing && current.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${base} ${suffix++}`;
          const saved = await this.store.save(root, name, googleConnection(chosen.sheet.id, client, tokens), existing?.id);
          await this.store.activate(root, saved.id); this.selectedId = saved.id;
          this.notify('Google Sheets connection saved securely and activated.');
          void this.panel?.webview.postMessage({ type: 'connectionSaved' });
          break;
        }
        case 'saveSettings': {
          this.requireTrust();
          const rel = saveProjectSettings(folder.uri.fsPath, m.settings);
          this.notify(`Project paths saved to ${rel}. Generate the client when you are ready.`);
          void this.panel?.webview.postMessage({ type: 'settingsSaved' });
          break;
        }
        case 'save': {
          this.requireTrust();
          if (typeof m.name !== 'string' || typeof m.connectionString !== 'string') throw new Error('Enter a name and connection string.');
          const target = typeof m.target === 'string' ? m.target : 'secret';
          if (!['secret', 'env', 'config'].includes(target)) throw new Error('Choose where to save this connection.');
          const value = m.connectionString.trim() || (id ? await this.store.secret(root, id) : undefined);
          if (!value || /[\r\n\0]/.test(value)) throw new Error('Enter a single-line connection string.');
          providerOf(value);
          if (target === 'env') {
            const rel = saveConnectionToEnv(folder.uri.fsPath, value);
            await this.store.activate(root); this.selectedId = undefined;
            this.notify(`Connection saved to ${rel}.`);
          } else if (target === 'config') {
            const rel = saveConnectionToConfig(folder.uri.fsPath, value);
            await this.store.activate(root); this.selectedId = undefined;
            this.notify(`Connection saved to ${rel}.`);
          } else {
            const saved = await this.store.save(root, m.name, m.connectionString, id);
            this.selectedId = saved.id; this.statuses.delete(`${root}:${saved.id}`);
            await this.store.activate(root, saved.id);
            this.notify('Connection saved securely.');
          }
          void this.panel?.webview.postMessage({ type: 'connectionSaved' });
          break;
        }
        case 'testDraft': {
          this.requireTrust();
          if (typeof m.connectionString !== 'string' || !m.connectionString.trim()) {
            throw new Error('Enter a connection string to test.');
          }
          try {
            const res = await testConnection(folder.uri.fsPath, m.connectionString.trim(), nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')));
            const status = `Connected · ${res.latencyMs} ms (${res.provider})`;
            this.notify(status);
            void this.panel?.webview.postMessage({ type: 'testDraftResult', success: true, latencyMs: res.latencyMs, provider: res.provider, text: status });
          } catch (error) {
            const msg = (error as Error).message || 'Connection failed';
            this.notify(msg, true);
            void this.panel?.webview.postMessage({ type: 'testDraftResult', success: false, error: msg });
          }
          break;
        }
        case 'browseSqlite': {
          this.requireTrust();
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: folder.uri,
            filters: { 'SQLite Databases': ['sqlite', 'sqlite3', 'db', 'db3'], 'All Files': ['*'] },
            openLabel: 'Select SQLite Database'
          });
          if (uris && uris[0]) {
            let rel = path.relative(folder.uri.fsPath, uris[0].fsPath);
            if (!rel.startsWith('.') && !path.isAbsolute(rel)) rel = `./${rel}`;
            void this.panel?.webview.postMessage({ type: 'sqliteChosen', path: rel });
          }
          break;
        }
        case 'test': if (!profile) throw new Error('Select a connection.'); await this.test(entry); break;
        case 'use': if (!profile) throw new Error('Select a connection.'); await this.use(entry); break;
        case 'remove': if (!profile) throw new Error('Select a connection.'); await this.remove(entry); break;
        case 'default': await this.store.activate(root); this.notify('AN5 now uses the project configuration or DATABASE_URL.'); break;
        case 'workspace': this.folder = await this.pickFolder(false) || folder; this.selectedId = undefined; break;
        case 'import': {
          this.requireTrust();
          const ws = resolveWorkspace(folder.uri.fsPath);
          if (!ws.connectionString) throw new Error('No connection found in DATABASE_URL, .env or an5Orm.config.');
          const saved = await this.store.save(root, `Project connection ${this.store.list(root).profiles.length + 1}`, ws.connectionString);
          this.selectedId = saved.id; this.notify('Project connection imported into secure storage.'); break;
        }
        case 'projectSource': {
          this.requireTrust();
          const source = projectConnection(folder.uri.fsPath)?.profile.source;
          if (source && source !== 'DATABASE_URL') await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, source)));
          else this.notify('This connection comes from the editor DATABASE_URL environment.');
          break;
        }
        case 'reference':
          await vscode.env.clipboard.writeText('connectionString: process.env.DATABASE_URL,');
          this.notify('Config reference copied. Paste inside module.exports in an5Orm.config.'); break;
        case 'action': {
          const allowed: Record<string, string> = { skills: 'an5.agentSkills.sync', config: 'an5.openConfig', generate: 'an5.generate', push: 'an5.push', pull: 'an5.pull', mcp: 'an5.mcp.install', servers: 'workbench.mcp.listServer' };
          if (m.action === 'schema') {
            this.requireTrust();
            const ws = resolveWorkspace(folder.uri.fsPath);
            const chosen = await vscode.window.showQuickPick(ws.schemaFiles.map(file => ({ label: path.relative(ws.root, file), file })), { placeHolder: 'Open an AN5 schema' });
            if (chosen) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(chosen.file));
          } else if (typeof m.action === 'string' && allowed[m.action]) {
            await vscode.commands.executeCommand(allowed[m.action], folder);
          }
          break;
        }
      }
      this.refresh();
    } catch (error) {
      // Only our validation errors are forwarded. Driver/config execution errors never include credentials.
      this.notify(m.type === 'import' ? 'Could not import configuration. Check the config syntax and connection setting.' : (error as Error).message, true);
    } finally { this.busy = false; await this.renderState(); }
  }
  private googleClientKey(folder: vscode.WorkspaceFolder): string {
    return `an5.google.oauth.client.${createHash('sha256').update(folder.uri.toString()).digest('hex')}`;
  }
  private notify(text: string, error = false): void { void this.panel?.webview.postMessage({ type: 'notice', text, error }); }
  private async use(entry: Entry): Promise<void> {
    this.requireTrust(); if (!entry.profile) return;
    await this.store.activate(entry.root.uri.toString(), entry.profile.project ? undefined : entry.profile.id);
    this.notify(`${entry.profile.name} is active. Restart running MCP servers to apply it.`); this.refresh();
  }
  private async remove(entry: Entry): Promise<void> {
    if (!entry.profile || entry.profile.project) return;
    const answer = await vscode.window.showWarningMessage(`Delete connection “${entry.profile.name}”?`, { modal: true }, 'Delete');
    if (answer !== 'Delete') return;
    await this.store.remove(entry.root.uri.toString(), entry.profile.id);
    this.statuses.delete(`${entry.root.uri.toString()}:${entry.profile.id}`);
    this.selectedId = undefined; this.notify('Connection deleted.'); this.refresh();
  }
  private async test(entry: Entry): Promise<void> {
    this.requireTrust(); if (!entry.profile) return;
    const secret = entry.profile.project ? projectConnection(entry.root.uri.fsPath)?.connectionString : await this.store.secret(entry.root.uri.toString(), entry.profile.id);
    if (!secret) throw new Error('Credentials are unavailable. Edit this connection to enter them again.');
    let result: { latencyMs: number; provider: string };
    try {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `AN5: Testing ${entry.profile.name}` }, () => testConnection(entry.root.uri.fsPath, secret, nodeRuntime(vscode.workspace.getConfiguration('an5', entry.root.uri).get<string>('nodePath'))));
    } catch (error) {
      this.statuses.set(`${entry.root.uri.toString()}:${entry.profile.id}`, 'Connection failed');
      this.refresh(); throw error;
    }
    const status = `Connected · ${result.latencyMs} ms`;
    this.statuses.set(`${entry.root.uri.toString()}:${entry.profile.id}`, status);
    this.notify(status); vscode.window.showInformationMessage(`AN5: ${entry.profile.name} — ${status}`); this.refresh();
  }
}
