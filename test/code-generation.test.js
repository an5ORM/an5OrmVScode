// Intentional Vietnamese requests verify multilingual input. an5:allow-non-english-file
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTools } = require('../dist/mcp/tools');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-code-'));
const ormDir = path.join(root, 'orm');
const apiPath = path.join(ormDir,'dist/generator/src/api.js');
fs.mkdirSync(path.dirname(apiPath), {recursive:true});
fs.writeFileSync(apiPath, `exports.detectProvider = () => 'postgresql'; exports.prepareCodeRequest = async input => {
 if (!input.request) throw new Error('request required');
 return {...input, status:'context_ready'};
};`);
const workspace = {root, schemaDir:path.join(root,'schema'), schemaFiles:[path.join(root,'schema/User.an5')], ormDir, connectionString:'sqlite::memory:'};
const tool = createTools(() => workspace).find(tool => tool.name === 'an5_generate_code');
test.after(() => fs.rmSync(root, {recursive:true,force:true}));
test('MCP forwards request, project, language, complete schema set and active provider', async () => {
 assert.equal(tool.annotations.readOnlyHint,true);
 const output = JSON.parse(await tool.handler({request:'Viết hàm đọc User',language:'python'}));
 assert.equal(output.request,'Viết hàm đọc User'); assert.equal(output.language,'python');
 assert.equal(output.projectRoot,root); assert.equal(output.schemaPath,workspace.schemaDir);
 assert.deepEqual(output.schemaFiles,workspace.schemaFiles); assert.equal(output.provider,'sqlite');
 assert.equal(output.status,'context_ready'); assert.equal(output.connectionString,undefined);
});
test('MCP forwards auto detection and reports unavailable ORM API clearly', async () => {
 assert.equal(JSON.parse(await tool.handler({request:'write code'})).language,'auto');
 await assert.rejects(tool.handler({language:'typescript'}), /request/);
 const missing = createTools(() => ({...workspace,ormDir:undefined})).find(tool => tool.name==='an5_generate_code');
 await assert.rejects(missing.handler({request:'write code'}), /Install @an5\/orm/);
 fs.writeFileSync(apiPath,'module.exports = {};'); delete require.cache[apiPath];
 await assert.rejects(tool.handler({request:'write code'}), /upgrade the ORM/);
});
