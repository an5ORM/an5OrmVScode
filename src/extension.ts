import * as path from 'path';
import * as vscode from 'vscode';

/** Id must match `contributes.mcpServerDefinitionProviders[].id` in package.json. */
const MCP_PROVIDER_ID = 'an5McpProvider';
const MCP_SERVER_LABEL = 'AN5 ORM';
/** Must match `version` in package.json. */
const MCP_SERVER_VERSION = '1.0.2';

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
      { label: '$(gear) Generate Client Code', description: 'Run npm run generate / an5 generate', command: 'an5.generate' },
      { label: '$(cloud-upload) Push Database Schema', description: 'Run npm run db:push / an5 push', command: 'an5.push' },
      { label: '$(cloud-download) Pull Database Schema', description: 'Run npm run db:pull / an5 pull', command: 'an5.pull' },
      { label: '$(settings-gear) Open Config File', description: 'Open or create an5Orm.config.js', command: 'an5.openConfig' },
    ];
    const selection = await vscode.window.showQuickPick(items, { placeHolder: 'AN5 ORM Commands' });
    if (selection) {
      vscode.commands.executeCommand(selection.command);
    }
  });
  context.subscriptions.push(menuCommand);

  // Command: Open or Create Config File
  const openConfigCommand = vscode.commands.registerCommand('an5.openConfig', async () => {
    const files = await vscode.workspace.findFiles('**/an5Orm.config.{js,cjs}', '**/node_modules/**', 1);
    if (files.length > 0) {
      const doc = await vscode.workspace.openTextDocument(files[0]);
      await vscode.window.showTextDocument(doc);
    } else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open to create an5Orm.config.js');
        return;
      }
      const newConfigPath = vscode.Uri.joinPath(workspaceFolder.uri, 'an5Orm.config.js');
      const defaultConfigContent = `/**
 * AN5 ORM Configuration
 */
module.exports = {
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
  },
  pull: {
    exclude: ['^__', '^sys\\\\.', '^igrations'],
    preserveRelations: true,
  },
  generation: {
    generateComments: true,
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

  // Helper to run terminal command
  function runAn5Command(cmdName: string, defaultNpmScript: string) {
    const terminal = vscode.window.createTerminal(`AN5 ORM: ${cmdName}`);
    terminal.show();
    terminal.sendText(`npm run ${defaultNpmScript} || npx an5 ${cmdName}`);
  }

  context.subscriptions.push(vscode.commands.registerCommand('an5.generate', () => runAn5Command('generate', 'generate')));
  context.subscriptions.push(vscode.commands.registerCommand('an5.push', () => runAn5Command('push', 'db:push')));
  context.subscriptions.push(vscode.commands.registerCommand('an5.pull', () => runAn5Command('pull', 'db:pull')));

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
  // as a child process with the first workspace folder as its working directory
  // so it discovers the project's schema, @an5/orm install and DATABASE_URL.

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot) {
    registerMcpServer(context, workspaceRoot);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('an5.mcp.showConfig', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!folder) {
        vscode.window.showErrorMessage('Open a folder before inspecting the AN5 MCP server configuration.');
        return;
      }
      const serverPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp', 'server.js').fsPath;
      const config = {
        servers: {
          'an5-orm': {
            type: 'stdio',
            command: 'node',
            args: [serverPath],
            cwd: folder.fsPath,
          },
        },
      };
      const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(config, null, 2),
      });
      await vscode.window.showTextDocument(document);
    }),
  );
}

/**
 * Registers the AN5 MCP server with VS Code so agentic clients discover it.
 *
 * The API is only present on newer VS Code builds; when it is missing the
 * extension still works and the `AN5: Show MCP Server Configuration` command
 * provides the snippet to paste into `.vscode/mcp.json` by hand.
 */
function registerMcpServer(context: vscode.ExtensionContext, workspaceRoot: vscode.Uri): void {
  const lm = vscode.lm as { registerMcpServerDefinitionProvider?: unknown };
  if (typeof lm.registerMcpServerDefinitionProvider !== 'function') {
    return;
  }

  const serverPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp', 'server.js').fsPath;
  const emitter = new vscode.EventEmitter<void>();

  // `as never` keeps this compiling against the ^1.60 @types/vscode the
  // extension is built with, where the MCP provider API is not declared yet.
  const register = vscode.lm.registerMcpServerDefinitionProvider as unknown as (
    id: string,
    provider: unknown,
  ) => vscode.Disposable;

  context.subscriptions.push(emitter);
  context.subscriptions.push(
    register(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: emitter.event,
      provideMcpServerDefinitions: async () => {
        const StdioDefinition = (
          vscode as unknown as {
            McpStdioServerDefinition: new (options: {
              label: string;
              command: string;
              args?: string[];
              cwd?: vscode.Uri;
              version?: string;
            }) => unknown;
          }
        ).McpStdioServerDefinition;

        if (typeof StdioDefinition !== 'function') {
          return [];
        }

        return [
          new StdioDefinition({
            label: MCP_SERVER_LABEL,
            command: 'node',
            args: [serverPath],
            cwd: workspaceRoot,
            version: MCP_SERVER_VERSION,
          }),
        ];
      },
      resolveMcpServerDefinition: async (definition: vscode.McpServerDefinition) => definition,
    }),
  );
}

export function deactivate() {}

