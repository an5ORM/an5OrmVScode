// Resolve TypeScript from environment or local checkout
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let result = spawnSync('tsc', ['-p', './'], { stdio: 'inherit', shell: true });
if (result.status !== 0) {
  try {
    const tscPath = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    result = spawnSync(process.execPath, [tscPath, '-p', './'], { stdio: 'inherit' });
  } catch (err) {
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
