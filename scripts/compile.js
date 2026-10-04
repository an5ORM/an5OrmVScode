// Resolve TypeScript from this checkout or its workspace without executable shims.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc'), '-p', './'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
