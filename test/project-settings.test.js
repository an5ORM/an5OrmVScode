const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {projectSettings,saveProjectSettings}=require('../dist/connections/project-settings');
test('project settings preserve custom configuration, credentials and idempotent managed paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'an5-project-settings-'));
 try {
  const file=path.join(root,'an5Orm.config.cjs');
  fs.writeFileSync(file,'// Keep custom config\nmodule.exports={connectionString:"sqlite:dev.db",generation:{generateMetadata:false},outputs:{rust:{custom:true}}};\n');
  const settings={...projectSettings({}),schemaDir:'schema',typescriptDir:'generated/ts'};
  assert.equal(saveProjectSettings(root,settings),'an5Orm.config.cjs');
  saveProjectSettings(root,settings);
  const source=fs.readFileSync(file,'utf8');assert.equal((source.match(/AN5 project settings: start/g)||[]).length,1);
  const result=require(file);assert.equal(result.schemaDir,'schema');assert.equal(result.connectionString,'sqlite:dev.db');
  assert.equal(result.generation.generateMetadata,false);assert.equal(result.outputs.rust.custom,true);
  assert.equal(result.outputs.typescript.outputDir,'generated/ts');assert.match(source,/Keep custom config/);
  for(const schemaDir of ['../outside','/outside','C:\\outside']) assert.throws(()=>saveProjectSettings(root,{...settings,schemaDir}),/inside this project/);
  assert.equal(fs.readFileSync(file,'utf8'),source);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('project settings can create config without persisting credentials',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'an5-new-settings-'));
 try{saveProjectSettings(root,projectSettings({}));const result=require(path.join(root,'an5Orm.config.js'));assert.equal(result.schemaDir,'an5Schema');assert.equal(result.connectionString,undefined)}finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('invalid JavaScript config is left untouched',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'an5-invalid-settings-'));
 try{const file=path.join(root,'an5Orm.config.js');fs.writeFileSync(file,'module.exports = { broken');assert.throws(()=>saveProjectSettings(root,projectSettings({})),/invalid JavaScript/);assert.equal(fs.readFileSync(file,'utf8'),'module.exports = { broken')}finally{fs.rmSync(root,{recursive:true,force:true})}
});
