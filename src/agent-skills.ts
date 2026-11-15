import * as fs from 'fs';
import * as path from 'path';
import { parseSchemaFiles } from './mcp/fallback-parser';

const start = '<!-- AN5 agent context: start -->';
const end = '<!-- AN5 agent context: end -->';
const managed = '<!-- Managed by AN5 ORM extension.';

function collectAn5Files(dir: string, depth = 0): string[] {
  if (depth > 3 || !fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'generated') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectAn5Files(full, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.an5')) results.push(full);
  }
  return results;
}

function buildLiveSchemaSummary(root: string): string {
  const schemaDir = path.join(root, 'an5Schema');
  const files = fs.existsSync(schemaDir) ? collectAn5Files(schemaDir) : collectAn5Files(root);
  if (!files.length) return '';
  const models = parseSchemaFiles(files.map(f => ({ path: f, contents: fs.readFileSync(f, 'utf8') })));
  if (!models.length) return '';
  return `\nSchema models detected: ${models.length}. Use MCP \`an5_list_models\` (with \`search\`) and \`an5_describe_model\` to inspect models on demand without loading schemas into context.\n`;
}

function mergeManagedBlock(filePath: string, context: string, label: string): string {
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const from = previous.indexOf(start), to = previous.indexOf(end);
  if ((from >= 0) !== (to >= 0) || (from >= 0 && (to < from || previous.indexOf(start, from + start.length) >= 0 || previous.indexOf(end, to + end.length) >= 0))) {
    throw new Error(`The AN5 section in ${label} is malformed. Repair its markers before syncing.`);
  }
  return from >= 0 ? previous.slice(0, from) + context + previous.slice(to + end.length) : previous + (previous && !previous.endsWith('\n') ? '\n' : '') + '\n' + context + '\n';
}

function safePath(root: string, relative: string): string {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Agent skill sync cannot write through symbolic links.');
    }
  }
  return current;
}

/** Replace only extension-owned guidance; never read configuration or credentials. */
export function syncAgentSkills(root: string, extensionRoot: string, options?: { includeAllIdes?: boolean }): string[] {
  const skillRelative = '.agents/skills/an5-orm/SKILL.md';
  const skillPath = safePath(root, skillRelative);
  const agentsPath = safePath(root, 'AGENTS.md');
  const template = fs.readFileSync(path.join(extensionRoot, 'skills/an5-orm/SKILL.md'), 'utf8');
  if (fs.existsSync(skillPath) && !fs.readFileSync(skillPath, 'utf8').includes(managed)) {
    throw new Error('An unmanaged an5-orm skill already exists. Rename it before syncing.');
  }
  let scripts: string[] = [];
  try { scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}).filter(s => s === 'generate' || s.startsWith('db:') || s === 'build' || s === 'test'); } catch { /* optional package */ }
  const configs = ['an5Orm.config.js', 'an5Orm.config.cjs'].filter(name => fs.existsSync(path.join(root, name)));
  const schemaSummary = buildLiveSchemaSummary(root);
  const context = `${start}\n## AN5 ORM agent guidance\n\nFor AN5 schema, query, adapter and client work, read [.agents/skills/an5-orm/SKILL.md](.agents/skills/an5-orm/SKILL.md).\n\nProject configuration files: ${JSON.stringify(configs)}.\nAvailable npm script names: ${JSON.stringify(scripts)}. Inspect their current definitions before running.\n${schemaSummary}\nThis section is maintained by **AN5: Sync Agent Skills**. Keep project-specific conventions outside its markers. Credentials and connection strings are not included.\n${end}`;
  const agents = mergeManagedBlock(agentsPath, context, 'AGENTS.md');
  const writes: Array<[string, string, string]> = [
    [skillPath, template, skillRelative],
    [agentsPath, agents, 'AGENTS.md'],
  ];

  const includeAll = !!options?.includeAllIdes;
  if (includeAll || fs.existsSync(path.join(root, 'CLAUDE.md'))) {
    const claudePath = safePath(root, 'CLAUDE.md');
    writes.push([claudePath, mergeManagedBlock(claudePath, context, 'CLAUDE.md'), 'CLAUDE.md']);
  }
  if (includeAll || fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) {
    const copilotPath = safePath(root, '.github/copilot-instructions.md');
    writes.push([copilotPath, mergeManagedBlock(copilotPath, context, '.github/copilot-instructions.md'), '.github/copilot-instructions.md']);
  }
  if (includeAll || fs.existsSync(path.join(root, '.cursor'))) {
    const cursorRel = '.cursor/rules/an5-orm.mdc';
    const cursorPath = safePath(root, cursorRel);
    const cursorBody = `---\ndescription: AN5 ORM schema, client, adapter and query rules\nglobs: **/*.an5,**/*.ts,**/*.js,**/*.py\nalwaysApply: true\n---\n\n${context}\n`;
    writes.push([cursorPath, cursorBody, cursorRel]);
  }

  const changed: string[] = [];
  for (const [file, content, relative] of writes) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content); changed.push(relative);
  }
  return changed;
}
