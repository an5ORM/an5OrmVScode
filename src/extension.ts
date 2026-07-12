import * as vscode from 'vscode';

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
  const formatter = vscode.languages.registerDocumentFormattingEditProvider('mssql-schema', {
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
}

export function deactivate() {}
