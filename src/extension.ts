import * as path from 'path';
import { projectCommand } from './project-command';
import { resolveWorkspace } from './mcp/workspace';
import { SchemaView } from './schema-view';
import { nodeRuntime } from './node-runtime';
import { ConnectionUi } from './connections/ui';
import * as vscode from 'vscode';
import {
  MCP_SERVER_KEY,
  McpJsonError,
  McpJsonRoot,
  mergeServerEntry,
  mcpJsonEntry,
  stdioSpec,
} from './mcp/definition';

/** Id must match `contributes.mcpServerDefinitionProviders[].id` in package.json. */
const MCP_PROVIDER_ID = 'an5McpProvider';

interface FieldDef {
  name: string;
  type: string;
  attributes: string;
}

function formatBlock(lines: string[]): string[] {
  const result: string[] = [];
  let maxNameLen = 0;
  let maxTypeLen = 0;

  const fieldLines: (FieldDef | string)[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      fieldLines.push('');
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
      fieldLines.push(trimmed);
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const name = parts[0];
    const type = parts[1];
    if (name && type && !name.includes('=') && !name.startsWith('@@')) {
      if (name.length > maxNameLen) maxNameLen = name.length;
      if (type.length > maxTypeLen) maxTypeLen = type.length;
      fieldLines.push({ name, type, attributes: parts.slice(2).join(' ') });
    } else {
      fieldLines.push(trimmed);
    }
  }

  let maxFieldTextLen = 0;
  for (const entry of fieldLines) {
    if (typeof entry !== 'string' && entry.attributes) {
      const text = `${entry.name.padEnd(maxNameLen, ' ')} ${entry.type.padEnd(maxTypeLen, ' ')}`;
      if (text.length > maxFieldTextLen) maxFieldTextLen = text.length;
    }
  }

  for (const entry of fieldLines) {
    if (typeof entry === 'string') {
      if (entry) result.push(`  ${entry}`);
      else result.push('');
    } else {
      const paddedName = entry.name.padEnd(maxNameLen, ' ');
      const paddedType = entry.type.padEnd(maxTypeLen, ' ');
      const fieldText = `${paddedName} ${paddedType}`;
      if (entry.attributes) {
        result.push(`  ${fieldText.padEnd(maxFieldTextLen, ' ')} ${entry.attributes}`);
      } else {
        result.push(`  ${fieldText}`);
      }
    }
  }
  return result;
}

function formatConfigBlock(lines: string[]): string[] {
  const result: string[] = [];
  let maxKeyLen = 0;
  const pairs: [string, string][] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (key.length > maxKeyLen) maxKeyLen = key.length;
      pairs.push([key, val]);
    } else {
      result.push(`  ${trimmed}`);
    }
  }

  for (const [key, val] of pairs) {
    result.push(`  ${key.padEnd(maxKeyLen, ' ')} = ${val}`);
  }
  return result;
}

function formatEnumBlock(lines: string[]): string[] {
  return lines
    .map(l => l.trim())
    .filter(Boolean)
    .map(v => `  ${v}`);
}

export function activate(context: vscode.ExtensionContext) {
  const connections = new ConnectionUi(context);
  context.subscriptions.push(connections, new SchemaView(connections));
  const formatter = vscode.languages.registerDocumentFormattingEditProvider('an5-schema', {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
      const edits: vscode.TextEdit[] = [];
      const text = document.getText();
      const rawLines = text.split(/\r?\n/);

      const formattedLines: string[] = [];
      let inBlock = false;
      let blockType: string | null = null;
      let blockBody: string[] = [];

      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const trimmed = line.trim();

        if (!inBlock) {
          if (trimmed === '}') {
            formattedLines.push(line);
            continue;
          }
          const blockMatch = trimmed.match(/^(model|enum|datasource|generator|type)\s+\S+\s*\{\s*$/);
          if (blockMatch) {
            inBlock = true;
            blockType = blockMatch[1];
            blockBody = [];
            formattedLines.push(line);
          } else {
            formattedLines.push(line);
          }
          continue;
        }

        if (trimmed === '}') {
          inBlock = false;
          let formatted: string[];
          switch (blockType) {
            case 'model':
            case 'type':
              formatted = formatBlock(blockBody);
              break;
            case 'enum':
              formatted = formatEnumBlock(blockBody);
              break;
            case 'datasource':
            case 'generator':
              formatted = formatConfigBlock(blockBody);
              break;
            default:
              formatted = formatBlock(blockBody);
          }
          formattedLines.push(...formatted);
          formattedLines.push('}');
          blockType = null;
          continue;
        }

        blockBody.push(line);
      }

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      edits.push(vscode.TextEdit.replace(fullRange, formattedLines.join('\n')));
      return edits;
    }
  });

  context.subscriptions.push(formatter);

  // --- AN5 ORM Configuration & Status Bar Tooling ---

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'an5.showMenu';

  async function updateStatusBar() {
    const configFiles = await vscode.workspace.findFiles('**/an5Orm.config.{js,cjs}', '**/node_modules/**', 1);
    const schemaFiles = await vscode.workspace.findFiles('**/*.an5', '**/node_modules/**', 1);

    if (configFiles.length > 0 || schemaFiles.length > 0) {
      statusBarItem.text = 'AN5 ORM';
      statusBarItem.tooltip = 'AN5 ORM Tooling Active. Click for actions.';
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  }

  updateStatusBar();
  context.subscriptions.push(statusBarItem);

  // Command: Show QuickPick menu
  const menuCommand = vscode.commands.registerCommand('an5.showMenu', async () => {
    const items = [
      { label: '$(database) Manage Connections', description: 'Secure database profiles and workspace tools', command: 'an5.connections.manage' },
      { label: '$(gear) Generate Client Code', description: 'Run npm run generate / an5 generate', command: 'an5.generate' },
      { label: '$(cloud-upload) Push Database Schema', description: 'Run npm run db:push / an5 push', command: 'an5.push' },
      { label: '$(cloud-download) Pull Database Schema', description: 'Run npm run db:pull / an5 pull', command: 'an5.pull' },
      { label: '$(settings-gear) Open Config File', description: 'Open or create an5Orm.config.js', command: 'an5.openConfig' },
      { label: '$(robot) Install MCP Server', description: 'Write the MCP server into this workspace', command: 'an5.mcp.install' },
      { label: '$(json) Show MCP Server Configuration', description: 'Show the MCP server configuration to copy', command: 'an5.mcp.showConfig' },
    ];
    const selection = await vscode.window.showQuickPick(items, { placeHolder: 'AN5 ORM Commands' });
    if (selection) {
      vscode.commands.executeCommand(selection.command);
    }
  });
  context.subscriptions.push(menuCommand);

  // Command: Open or Create Config File
  const openConfigCommand = vscode.commands.registerCommand('an5.openConfig', async (selectedFolder?: vscode.WorkspaceFolder) => {
    const folder = selectedFolder || await connections.pickFolder();
    if (!folder) return;
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, 'an5Orm.config.{js,cjs}'), '**/node_modules/**', 1);
    if (files.length > 0) {
      const doc = await vscode.workspace.openTextDocument(files[0]);
      await vscode.window.showTextDocument(doc);
    } else {
      const workspaceFolder = folder;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open to create an5Orm.config.js');
        return;
      }
      const newConfigPath = vscode.Uri.joinPath(workspaceFolder.uri, 'an5Orm.config.js');
      const defaultConfigContent = `/**
 * AN5 ORM Configuration
 */
module.exports = {
  connectionString: process.env.DATABASE_URL,
  schemaDir: 'an5Schema',
  outputs: {
    typescript: {
      outputDir: 'an5Client/typescript',
      metadataFile: 'an5Client/typescript/an5Metadata.ts',
    },
    python: {
      metadataFile: 'an5Client/python/an5_metadata.py',
    },
    dotnet: {
      outputDir: 'an5Client/dotnet',
    },
    golang: { outputDir: 'an5Client/golang' },
    rust: { outputDir: 'an5Client/rust' },
  },
  pull: {
    exclude: ['^__', '^sys\\\\.', '^igrations'],
    preserveRelations: true,
  },
  generation: {
    generateMetadata: true,
  },
};
`;
      await vscode.workspace.fs.writeFile(newConfigPath, new TextEncoder().encode(defaultConfigContent));
      const doc = await vscode.workspace.openTextDocument(newConfigPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Created an5Orm.config.js in workspace root!');
    }
  });
  context.subscriptions.push(openConfigCommand);

  // Commands use the selected workspace and pass credentials through the terminal environment.
  async function runAn5Command(cmdName: string, defaultNpmScript: string, selectedFolder?: vscode.WorkspaceFolder) {
    if (!vscode.workspace.isTrusted) { vscode.window.showErrorMessage('Trust this workspace before running AN5 commands.'); return; }
    const folder = selectedFolder || await connections.pickFolder();
    if (!folder) return;
    if (cmdName === 'push' || cmdName === 'pull') {
      const action = cmdName === 'push' ? 'Push schema' : 'Pull schema';
      const description = cmdName === 'push' ? 'This can change database tables and columns.' : 'This can overwrite schema files.';
      if (await vscode.window.showWarningMessage(`${action} in ${folder.name}? ${description}`, { modal: true }, action) !== action) return;
    }
    try {
      const ws = resolveWorkspace(folder.uri.fsPath);
      if (cmdName !== 'pull' && !ws.schemaFiles.length) throw new Error('No .an5 schema files found. Create a schema before generating or pushing.');
      const active = await connections.environment(folder);
      const plan = projectCommand({ ...ws, connectionString: active.DATABASE_URL || ws.connectionString }, defaultNpmScript, [], nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')));
      const options = { cwd: plan.cwd, env: plan.env };
      const execution = process.platform === 'win32' && plan.command === 'npm.cmd'
        ? new vscode.ShellExecution(plan.command, plan.args, options)
        : new vscode.ProcessExecution(plan.command, plan.args, options);
      const task = new vscode.Task({ type: 'an5', action: cmdName }, vscode.workspace.getWorkspaceFolder(folder.uri) || folder, `AN5: ${cmdName}`, 'AN5 ORM', execution);
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.New, clear: false };
      await vscode.tasks.executeTask(task);
    } catch (error) { vscode.window.showErrorMessage(`AN5: ${(error as Error).message}`); }

  }
  context.subscriptions.push(vscode.commands.registerCommand('an5.generate', (folder?: vscode.WorkspaceFolder) => runAn5Command('generate', 'generate', folder)));
  context.subscriptions.push(vscode.commands.registerCommand('an5.push', (folder?: vscode.WorkspaceFolder) => runAn5Command('push', 'db:push', folder)));
  context.subscriptions.push(vscode.commands.registerCommand('an5.pull', (folder?: vscode.WorkspaceFolder) => runAn5Command('pull', 'db:pull', folder)));

  // Completion & Hover provider for an5Orm.config.js / cjs
  const configSelector: vscode.DocumentFilter[] = [
    { pattern: '**/an5Orm.config.js' },
    { pattern: '**/an5Orm.config.cjs' }
  ];

  const configHoverProvider = vscode.languages.registerHoverProvider(configSelector, {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position);
      const word = document.getText(range);

      const docs: Record<string, string> = {
        schemaDir: '**schemaDir**: Path to directory containing `.an5` schema files (default: `"an5Schema"`).',
        outputs: '**outputs**: Targets for generated client artifacts (`typescript`, `python`, `dotnet`).',
        typescript: '**typescript**: TypeScript client output directory and metadata path.',
        python: '**python**: Python client metadata output path.',
        dotnet: '**dotnet**: .NET (C#) client models output directory.',
        pull: '**pull**: Settings for database schema reverse-engineering (`exclude`, `preserveRelations`).',
        generation: '**generation**: Options for comments and metadata code generation.'
      };

      if (docs[word]) {
        return new vscode.Hover(new vscode.MarkdownString(docs[word]));
      }
      return null;
    }
  });
  context.subscriptions.push(configHoverProvider);

  // --- MCP server for agentic clients (GitHub Copilot, etc.) ----------------
  //
  // The server is a stdio MCP server shipped with this extension. It is started
  // as a child process with a workspace folder as its working directory so it
  // discovers the project's schema, @an5/orm install and DATABASE_URL.
  //
  // Registration needs no folder: the provider is registered unconditionally and
  // the folders are read when VS Code asks, so a server shows up in a window that
  // has none open yet.
  registerMcpServer(context, connections);

  context.subscriptions.push(
    vscode.commands.registerCommand('an5.mcp.install', async (folder?: vscode.WorkspaceFolder) => {
      await installMcpServer(context, folder || await connections.pickFolder());
    }),
    vscode.commands.registerCommand('an5.mcp.showConfig', async () => {
      await showMcpConfig(context);
    }),
  );
}

/**
 * Registers the AN5 MCP server with VS Code so agentic clients discover it.
 *
 * The provider is the automatic path: it needs VS Code 1.101+, which is what
 * `engines.vscode` already requires. On an older build — or an editor like Cursor
 * and VSCodium that may predate it — `registerMcpServerDefinitionProvider` is
 * absent, the registration is skipped, and `AN5: Install MCP Server` is the way in
 * because it writes the config file itself.
 */
function registerMcpServer(context: vscode.ExtensionContext, connections: ConnectionUi): void {
  // Present from VS Code 1.101. The guard keeps the extension loadable on builds
  // where the API is missing, which is also what happens on a host that shims the
  // namespace.
  const register = vscode.lm?.registerMcpServerDefinitionProvider;
  if (typeof register !== 'function') {
    return;
  }

  const emitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(emitter);

  context.subscriptions.push(connections.onDidChange(() => emitter.fire()));

  // VS Code asks again when this fires, so a folder opened or closed after
  // activation is reflected instead of staying stale.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => emitter.fire()),
  );

  context.subscriptions.push(
    register(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: emitter.event,
      provideMcpServerDefinitions: async (token) => {
        const folders = connections.projects();
        if (!vscode.workspace.isTrusted || !folders || folders.length === 0) return [];

        const extensionPath = context.extensionUri.fsPath;
        const version = extensionVersion(context);

        return folders.map((folder) => {
          const spec = stdioSpec({
            extensionPath,
            // The node running this extension host, not `'node'` from a PATH the
            // server would not inherit.
            nodePath: nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')).command,
            env: nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')).env,
            cwd: folder.uri.fsPath,
            version,
          });

          // Positional, matching `McpStdioServerDefinition`'s signature. `cwd` is
          // assigned separately because the constructor does not take it.
          const definition = new vscode.McpStdioServerDefinition(
            folders.length > 1 ? `${spec.label} · ${folder.name}` : spec.label,
            spec.command,
            spec.args,
            spec.env || {},
            spec.version,
          );
          definition.cwd = folder.uri;

          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
          return definition;
        });
      },
      resolveMcpServerDefinition: async (definition) => {
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before launching AN5 MCP.');
        if (definition instanceof vscode.McpStdioServerDefinition && definition.cwd) {
          const folder = connections.projects().find(f => f.uri.toString() === definition.cwd!.toString()) || vscode.workspace.getWorkspaceFolder(definition.cwd);
          if (folder) {
            const env = { ...definition.env };
            delete env.DATABASE_URL;
            definition.env = { ...env, ...await connections.environment(folder) };
          }
        }
        return definition;
      },
    }),
  );
}

/**
 * The extension version, used as the server's cache nonce.
 *
 * Read from the manifest instead of being repeated here: a stale constant meant
 * VS Code stopped noticing that the server's tools had changed.
 */
function extensionVersion(context: vscode.ExtensionContext): string | undefined {
  const version = context.extension?.packageJSON?.version;
  return typeof version === 'string' ? version : undefined;
}

/**
 * Writes the server into an MCP config file so it works without the registration
 * API — and so it keeps working when the user is on a build that predates it.
 *
 * The merge preserves every other server, and running it twice changes nothing.
 */
async function installMcpServer(context: vscode.ExtensionContext, selectedFolder?: vscode.WorkspaceFolder): Promise<void> {
  const folder = selectedFolder;
  if (!folder) {
    const open = await vscode.window.showErrorMessage(
      'Open the folder that holds your AN5 project before installing the MCP server.',
      'Open Folder',
    );
    if (open) await vscode.commands.executeCommand('vscode.openFolder');
    return;
  }

  const targets: { label: string; root: McpJsonRoot; description: string }[] = [
    {
      label: '.mcp.json (workspace)',
      root: '.mcp.json',
      description: 'Portable, shared with other agent tools',
    },
    {
      label: '.vscode/mcp.json (workspace)',
      root: '.vscode/mcp.json',
      description: 'VS Code format',
    },
  ];

  const picked = await vscode.window.showQuickPick(targets, {
    title: 'AN5: Install MCP Server',
    placeHolder: 'Choose where to write the AN5 MCP server',
  });
  if (!picked) return;

  const relative = picked.root;
  const target = vscode.Uri.joinPath(folder.uri, ...relative.split('/'));
  const spec = stdioSpec({
    extensionPath: context.extensionUri.fsPath,
    nodePath: nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')).command,
    env: nodeRuntime(vscode.workspace.getConfiguration('an5', folder.uri).get<string>('nodePath')).env,
    cwd: folder.uri.fsPath,
    version: extensionVersion(context),
  });

  const current = await readFileIfExists(target);
  let merged;
  try {
    merged = mergeServerEntry(current, MCP_SERVER_KEY, mcpJsonEntry(spec), picked.root);
  } catch (error) {
    const message = error instanceof McpJsonError ? error.message : String(error);
    const open = await vscode.window.showErrorMessage(`AN5: could not update ${relative} — ${message}`, 'Open File');
    if (open) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    return;
  }

  if (!merged.changed) {
    vscode.window.showInformationMessage(`AN5: the MCP server is already configured in ${relative}.`);
    return;
  }

  // Only the .vscode/mcp.json target needs its directory; creating it for the
  // portable file would leave an empty .vscode behind in the project.
  const parent = picked.root === '.vscode/mcp.json' ? vscode.Uri.joinPath(folder.uri, '.vscode') : folder.uri;
  await vscode.workspace.fs.createDirectory(parent);
  await vscode.workspace.fs.writeFile(target, Buffer.from(merged.text, 'utf8'));

  const open = await vscode.window.showInformationMessage(
    `AN5: MCP server written to ${relative}. Run "MCP: List Servers" to start it.`,
    'Open File',
  );
  if (open) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
}

/** Shows the resolved configuration, so the path is a real one and not a placeholder. */
async function showMcpConfig(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) {
    vscode.window.showErrorMessage('Open a folder before inspecting the AN5 MCP server configuration.');
    return;
  }

  const spec = stdioSpec({
    extensionPath: context.extensionUri.fsPath,
    nodePath: nodeRuntime(vscode.workspace.getConfiguration('an5', folder).get<string>('nodePath')).command,
    env: nodeRuntime(vscode.workspace.getConfiguration('an5', folder).get<string>('nodePath')).env,
    cwd: folder.fsPath,
    version: extensionVersion(context),
  });

  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: `${JSON.stringify({ servers: { [MCP_SERVER_KEY]: mcpJsonEntry(spec) } }, null, 2)}\n`,
  });
  await vscode.window.showTextDocument(document);
}

async function readFileIfExists(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return '';
    throw error;
  }
}

export function deactivate() {}

