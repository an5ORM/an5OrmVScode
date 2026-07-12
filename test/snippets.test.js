const assert = require('assert');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

assert.ok(packageJson.contributes && packageJson.contributes.snippets, 'Expected snippets contribution');
const snippetContribution = packageJson.contributes.snippets.find((entry) => entry.language === 'mssql-schema');
assert.ok(snippetContribution, 'Expected mssql-schema snippet contribution');
const snippetFilePath = path.join(__dirname, '..', snippetContribution.path);
assert.ok(fs.existsSync(snippetFilePath), 'Expected snippet file to exist');

console.log('Snippet contribution test passed');
