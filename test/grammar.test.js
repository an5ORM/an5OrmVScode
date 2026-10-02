const assert = require('assert');
const fs = require('fs');
const path = require('path');

const grammarPath = path.join(__dirname, '..', 'syntaxes', 'an5.tmLanguage.json');
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

const postgresTypes = [
  'varchar', 'character', 'character varying', 'char', 'text', 'uuid', 'xml', 'json', 'jsonb',
  'inet', 'cidr', 'smallint', 'int2', 'int4', 'integer', 'int8', 'bigint', 'smallserial',
  'serial', 'bigserial', 'decimal', 'numeric', 'real', 'double precision', 'money', 'boolean',
  'bool', 'date', 'time', 'timetz', 'time with time zone', 'time without time zone', 'timestamp',
  'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'interval', 'bytea',
  'geography', 'geometry', 'vector'
];

for (const typeName of postgresTypes) {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedType = typeName.toLowerCase();
  assert.ok(normalizedPattern.includes(normalizedType), `Expected grammar to cover PostgreSQL type: ${typeName}`);
}

const mysqlTypes = [
  'char', 'varchar', 'nchar', 'nvarchar', 'tinytext', 'text', 'mediumtext', 'longtext',
  'enum', 'set', 'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'serial',
  'decimal', 'numeric', 'fixed', 'float', 'double', 'double precision', 'real', 'boolean',
  'bool', 'bit', 'date', 'datetime', 'timestamp', 'time', 'year', 'binary', 'varbinary',
  'tinyblob', 'blob', 'mediumblob', 'longblob', 'json', 'geometry', 'point', 'linestring', 'polygon'
];

for (const typeName of mysqlTypes) {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedType = typeName.toLowerCase();
  assert.ok(normalizedPattern.includes(normalizedType), `Expected grammar to cover MySQL type: ${typeName}`);
}

const sqliteTypes = [
  'integer', 'int', 'int2', 'int8', 'tinyint', 'smallint', 'mediumint', 'bigint',
  'unsigned big int', 'real', 'double', 'double precision', 'float', 'numeric', 'decimal',
  'boolean', 'bool', 'text', 'clob', 'varchar', 'nvarchar', 'char', 'nchar', 'character',
  'varying character', 'blob', 'date', 'datetime', 'timestamp', 'time', 'year', 'json',
  'uuid', 'vector'
];

for (const typeName of sqliteTypes) {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedType = typeName.toLowerCase();
  assert.ok(normalizedPattern.includes(normalizedType), `Expected grammar to cover SQLite type: ${typeName}`);
}

const googleSheetsTypes = [
  'string', 'text', 'varchar', 'nvarchar', 'char', 'nchar', 'clob', 'int', 'integer',
  'smallint', 'tinyint', 'bigint', 'float', 'double', 'decimal', 'numeric', 'real',
  'boolean', 'bool', 'date', 'datetime', 'timestamp', 'time', 'bytes', 'blob', 'vector'
];

for (const typeName of googleSheetsTypes) {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedType = typeName.toLowerCase();
  assert.ok(normalizedPattern.includes(normalizedType), `Expected grammar to cover Google Sheets type: ${typeName}`);
}

console.log('Grammar type coverage test passed for all providers (mssql, postgres, mysql, sqlite, googlesheets)');
