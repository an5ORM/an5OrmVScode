import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolveWorkspace } from './mcp/workspace';
import { An5Model, loadSchemaModels, qualifiedTable } from './mcp/schema-reader';
import { ConnectionUi } from './connections/ui';

type Entry = { folder: vscode.WorkspaceFolder; model?: An5Model; label?: string; description?: string; icon?: string };

/** Browse declared models without automatically connecting to a user's database. */
export class SchemaView implements vscode.TreeDataProvider<Entry>, vscode.Disposable {
  private readonly events = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this.events.event;
  private readonly disposables: vscode.Disposable[];
  constructor(private readonly connections: ConnectionUi) {
    this.disposables = [
      vscode.window.createTreeView('an5.schema', { treeDataProvider: this, showCollapseAll: true }),
      connections.onDidChange(() => this.events.fire(undefined)),
      vscode.commands.registerCommand('an5.schema.refresh', () => this.events.fire(undefined)),
      vscode.commands.registerCommand('an5.schema.openModel', async (entry: Entry) => {
        if (!entry.model || !vscode.workspace.isTrusted) return;
        const ws = resolveWorkspace(entry.folder.uri.fsPath);
        const name = entry.model.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^\\s*model\\s+${name}\\s*\\{`, 'm');
        const file = ws.schemaFiles.find(candidate => regex.test(fs.readFileSync(candidate, 'utf8')));
        if (!file) return;
        const doc = await vscode.workspace.openTextDocument(file);
        const match = regex.exec(doc.getText());
        const start = doc.positionAt(match?.index ?? 0);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(start, start) });
      }),
    ];
  }
  dispose(): void { this.events.dispose(); this.disposables.forEach(d => d.dispose()); }
  getTreeItem(entry: Entry): vscode.TreeItem {
    if (entry.label) {
      const item = new vscode.TreeItem(entry.label); item.description = entry.description; item.iconPath = new vscode.ThemeIcon(entry.icon || 'symbol-field'); return item;
    }
    const item = new vscode.TreeItem(entry.model?.name || entry.folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(entry.model ? 'symbol-class' : 'root-folder');
    if (entry.model) {
      item.description = qualifiedTable(entry.model);
      item.tooltip = entry.model.description;
      item.command = { command: 'an5.schema.openModel', title: 'Open model declaration', arguments: [entry] };
    }
    return item;
  }
  async getChildren(entry?: Entry): Promise<Entry[]> {
    if (!entry) return this.connections.projects().map(folder => ({ folder }));
    if (entry.label) return [];
    const folder = entry.folder;
    if (entry.model) {
      return [
        ...entry.model.fields.map(f => ({ folder, label: f.name, description: `${f.sqlType}${f.isOptional ? ' ?' : ''}${f.isId ? ' · primary key' : f.isUnique ? ' · unique' : ''}`, icon: f.isId ? 'key' : 'symbol-field' })),
        ...entry.model.relations.map(r => ({ folder, label: r.name, description: `${r.target}${r.isArray ? '[]' : ''}`, icon: 'references' })),
      ];
    }
    if (!vscode.workspace.isTrusted) return [{ folder, label: 'Trust workspace to inspect schema', icon: 'lock' }];
    try {
      const ws = resolveWorkspace(folder.uri.fsPath);
      if (!ws.schemaFiles.length) return [{ folder, label: 'No .an5 schemas found', description: path.relative(ws.root, ws.schemaDir), icon: 'info' }];
      const env = await this.connections.environment(folder);
      const models = await loadSchemaModels({ ...ws, connectionString: env.DATABASE_URL || ws.connectionString });
      return models.map(model => ({ folder, model }));
    } catch {
      return [{ folder, label: 'Could not parse schema', description: 'Check ORM config and schema types', icon: 'error' }];
    }
  }
}
