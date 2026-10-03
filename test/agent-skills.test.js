const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {syncAgentSkills} = require('../dist/agent-skills');
const extension = path.resolve(__dirname, '..');
function fixture(callback) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-skills-')); try { callback(root); } finally {fs.rmSync(root, {recursive:true, force:true});} }
test('sync preserves user conventions, omits credentials and refreshes project scripts idempotently', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# User conventions\nKeep these rules.\n');
  fs.writeFileSync(path.join(root, 'an5Orm.config.js'), 'throw new Error("Config must not execute")');
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=secret-value');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({scripts:{generate:'echo secret-value'}}));
  assert.equal(syncAgentSkills(root, extension).length, 2);
  const text = fs.readFileSync(path.join(root,'AGENTS.md'),'utf8');
  assert.ok(text.startsWith('# User conventions\nKeep these rules.\n'));
  assert.ok(text.includes('generate')); assert.ok(!text.includes('secret-value'));
  assert.deepEqual(syncAgentSkills(root, extension), []);
  fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({scripts:{'db:pull':'echo hello'}}));
  syncAgentSkills(root, extension);
  assert.ok(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8').includes('db:pull'));
}));
test('conflicting user skill and malformed markers are preserved without partial writes', () => fixture(root => {
  const skill=path.join(root,'.agents/skills/an5-orm/SKILL.md');fs.mkdirSync(path.dirname(skill),{recursive:true});fs.writeFileSync(skill,'User skill');
  assert.throws(()=>syncAgentSkills(root,extension), /unmanaged/);
  assert.equal(fs.readFileSync(skill,'utf8'),'User skill');assert.ok(!fs.existsSync(path.join(root,'AGENTS.md')));
  fs.unlinkSync(skill);fs.writeFileSync(path.join(root,'AGENTS.md'),'<!-- AN5 agent context: start -->');
  assert.throws(()=>syncAgentSkills(root,extension), /malformed/);assert.ok(!fs.existsSync(skill));
}));
test('nested project stays isolated and symlink targets are never written', () => fixture(root => {
  const child=path.join(root,'child');fs.mkdirSync(child);syncAgentSkills(child,extension);
  assert.ok(!fs.existsSync(path.join(root,'AGENTS.md')));
  fs.symlinkSync(child,path.join(root,'.agents'),'dir');
  assert.throws(()=>syncAgentSkills(root,extension), /symbolic links/);
  assert.ok(!fs.existsSync(path.join(child,'skills')));
}));
