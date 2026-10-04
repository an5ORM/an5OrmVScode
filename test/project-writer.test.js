const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { saveConnectionToEnv, saveConnectionToConfig } = require('../dist/connections/project-writer');

test('saveConnectionToEnv creates .env with DATABASE_URL or updates existing key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-env-test-'));
  try {
    // 1. Initial write
    saveConnectionToEnv(dir, 'postgresql://user:pass@localhost:5432/mydb');
    const content1 = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    assert.match(content1, /DATABASE_URL="postgresql:\/\/user:pass@localhost:5432\/mydb"/);

    // 2. Add extra variables and update DATABASE_URL
    fs.writeFileSync(path.join(dir, '.env'), `PORT=3000\n${content1}NODE_ENV=development\n`, 'utf8');
    saveConnectionToEnv(dir, 'mysql://root:secret@localhost:3306/appdb');
    const content2 = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    assert.match(content2, /PORT=3000/);
    assert.match(content2, /NODE_ENV=development/);
    assert.match(content2, /DATABASE_URL="mysql:\/\/root:secret@localhost:3306\/appdb"/);
    assert.doesNotMatch(content2, /postgresql/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveConnectionToConfig creates an5Orm.config.js or updates connectionString', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-config-test-'));
  try {
    // 1. Creates config file if not exists
    saveConnectionToConfig(dir, 'sqlite:./dev.sqlite');
    const configPath = path.join(dir, 'an5Orm.config.js');
    assert.ok(fs.existsSync(configPath));
    let content = fs.readFileSync(configPath, 'utf8');
    assert.match(content, /connectionString:\s*"sqlite:\.\/dev\.sqlite"/);

    // 2. Updates existing connectionString
    saveConnectionToConfig(dir, 'sqlserver://localhost:1433;database=mydb');
    content = fs.readFileSync(configPath, 'utf8');
    assert.match(content, /connectionString:\s*"sqlserver:\/\/localhost:1433;database=mydb"/);
    assert.doesNotMatch(content, /sqlite:\.\/dev\.sqlite/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
