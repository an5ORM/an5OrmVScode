const assert = require('assert');
const fs = require('fs');
const path = require('path');

const grammarPath = path.join(__dirname, '..', 'syntaxes', 'mssql.tmLanguage.json');
const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
const pattern = grammar.repository.types.patterns[0].match;

const sqlServerTypes = [
  'bigint', 'int', 'smallint', 'tinyint', 'bit',
  'decimal', 'numeric', 'money', 'smallmoney', 'float', 'real',
  'char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary',
  'date', 'time', 'datetime2', 'datetimeoffset', 'smalldatetime', 'datetime', 'timestamp',
  'uniqueidentifier', 'xml', 'sql_variant', 'rowversion', 'hierarchyid', 'geography', 'geometry',
  'sysname', 'image', 'text', 'ntext', 'variant'
];

for (const typeName of sqlServerTypes) {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedType = typeName.toLowerCase();
  assert.ok(normalizedPattern.includes(normalizedType), `Expected grammar to cover SQL Server type: ${typeName}`);
}

console.log('Grammar type coverage test passed');
