import * as fs from 'fs';
import * as path from 'path';

const start = '<!-- AN5 agent context: start -->';
const end = '<!-- AN5 agent context: end -->';
const managed = '<!-- Managed by AN5 ORM extension.';

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
export function syncAgentSkills(root: string, extensionRoot: string): string[] {
  const skillRelative = '.agents/skills/an5-orm/SKILL.md';
  const skillPath = safePath(root, skillRelative);
  const agentsPath = safePath(root, 'AGENTS.md');
  const template = fs.readFileSync(path.join(extensionRoot, 'skills/an5-orm/SKILL.md'), 'utf8');
  if (fs.existsSync(skillPath) && !fs.readFileSync(skillPath, 'utf8').includes(managed)) {
    throw new Error('An unmanaged an5-orm skill already exists. Rename it before syncing.');
  }
  const previous = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const from = previous.indexOf(start), to = previous.indexOf(end);
  if ((from >= 0) !== (to >= 0) || (from >= 0 && (to < from || previous.indexOf(start, from + start.length) >= 0 || previous.indexOf(end, to + end.length) >= 0))) {
    throw new Error('The AN5 section in AGENTS.md is malformed. Repair its markers before syncing.');
  }
  let scripts: string[] = [];
  try { scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}).filter(s => s === 'generate' || s.startsWith('db:') || s === 'build' || s === 'test'); } catch { /* optional package */ }
  const configs = ['an5Orm.config.js', 'an5Orm.config.cjs'].filter(name => fs.existsSync(path.join(root, name)));
  const context = `${start}\n## AN5 ORM agent guidance\n\nFor AN5 schema, query, adapter and client work, read [.agents/skills/an5-orm/SKILL.md](.agents/skills/an5-orm/SKILL.md).\n\nProject configuration files: ${JSON.stringify(configs)}.\nAvailable npm script names: ${JSON.stringify(scripts)}. Inspect their current definitions before running.\n\nThis section is maintained by **AN5: Sync Agent Skills**. Keep project-specific conventions outside its markers. Credentials and connection strings are not included.\n${end}`;
  const agents = from >= 0 ? previous.slice(0, from) + context + previous.slice(to + end.length) : previous + (previous && !previous.endsWith('\n') ? '\n' : '') + '\n' + context + '\n';
  const changed: string[] = [];
  for (const [file, content, relative] of [[skillPath, template, skillRelative], [agentsPath, agents, 'AGENTS.md']]) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content); changed.push(relative);
  }
  return changed;
}
