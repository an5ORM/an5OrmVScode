const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(packageJson.contributes && packageJson.contributes.languages, 'Expected language contribution');
assert.ok(fs.existsSync(path.join(root, 'syntaxes', 'mssql.tmLanguage.json')), 'Expected grammar file');
assert.ok(fs.existsSync(path.join(root, 'snippets', 'mssql-schema.json')), 'Expected snippet file');

console.log('mssqlOrmVScode smoke test passed');
