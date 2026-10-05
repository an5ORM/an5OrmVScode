const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run upload:marketplace -- [--no-open]\nRuns tests, packages a VSIX, and opens the publisher page for manual upload.');
  process.exit(0);
}
if (args.some(arg => arg !== '--no-open')) {
  console.error('Unknown option. Use --help for usage.');
  process.exit(1);
}
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `${command} failed (${result.status}).`);
    process.exit(1);
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsceManifestPath = require.resolve('@vscode/vsce/package.json', { paths: [root] });
const vsceManifest = JSON.parse(fs.readFileSync(vsceManifestPath, 'utf8'));
const vsce = path.resolve(path.dirname(vsceManifestPath), typeof vsceManifest.bin === 'string' ? vsceManifest.bin : vsceManifest.bin.vsce);
const artifact = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
const publisherUrl = `https://marketplace.visualstudio.com/manage/publishers/${encodeURIComponent(manifest.publisher)}`;
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']);
run(process.execPath, [vsce, 'package', '--no-dependencies', '--out', artifact]);
if (!fs.existsSync(artifact) || !fs.statSync(artifact).size) throw new Error('VSIX was not created.');
console.log(`\nReady for manual upload: ${manifest.publisher}.${manifest.name} ${manifest.version}\nVSIX: ${artifact}\nPublisher: ${publisherUrl}\nSelect More Actions → Update, choose this VSIX, then Upload.\nWait for verification and check the published version.\nAn already published version cannot be uploaded again; update package.json first.`);
if (!args.includes('--no-open')) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', publisherUrl] : [publisherUrl];
  const result = spawnSync(command, argv, { stdio: 'ignore' });
  if (result.error || result.status !== 0) console.warn('Could not open the browser. Open the publisher link above.');
}
