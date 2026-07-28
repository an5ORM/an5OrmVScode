const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(packageJson.contributes && packageJson.contributes.languages, 'Expected language contribution');
assert.ok(fs.existsSync(path.join(root, 'syntaxes', 'an5.tmLanguage.json')), 'Expected grammar file');
assert.ok(fs.existsSync(path.join(root, 'snippets', 'an5-schema.json')), 'Expected snippet file');

console.log('an5OrmVScode smoke test passed');
