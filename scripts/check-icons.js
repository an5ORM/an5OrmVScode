#!/usr/bin/env node
/**
 * Verify this extension's committed icons against the shared AN5 brand tokens.
 *
 * Delegates to the an5Brand generators but validates ./icons, so a stale or
 * hand-edited icon fails here too. Building and packaging the extension never
 * needs the submodule; only this check and regeneration do.
 *
 * Usage: node scripts/check-icons.js
 */

const fs = require('fs');
const path = require('path');

function resolveBrand() {
  const candidates = [];
  if (process.env.AN5_BRAND_PATH) candidates.push(path.resolve(process.env.AN5_BRAND_PATH));

  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'an5Brand'));
    candidates.push(path.join(dir, '..', 'an5Brand'));
    dir = path.dirname(dir);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'tokens.json'))) return candidate;
  }

  throw new Error([
    'Could not locate the an5Brand submodule, which provides the shared brand tokens.',
    'Initialise it with: git submodule update --init an5Brand',
    'Or set AN5_BRAND_PATH to an existing an5Brand checkout.',
  ].join('\n'));
}

async function main() {
  const brandRoot = resolveBrand();
  const { loadTokens, wordmarkSvg, activitySvg } = require(path.join(brandRoot, 'scripts', 'generate-icons.js'));
  const sharp = require('sharp');

  const iconsDir = path.resolve(__dirname, '..', 'icons');
  const tokens = loadTokens(path.join(brandRoot, 'tokens.json'));
  const files = new Map();

  files.set(tokens.icons.activityFile, { contents: activitySvg(tokens) });

  for (const size of tokens.icons.sizes) {
    const stem = tokens.icons.wordmarkFile.replace(/\{size\}/g, size);
    const svg = wordmarkSvg(tokens, size);
    files.set(`${stem}.svg`, { contents: svg });
    files.set(`${stem}.png`, { render: { svg, size } });
    if (size === tokens.icons.defaultSize) {
      files.set(`${tokens.icons.defaultFile}.svg`, { contents: svg });
      files.set(`${tokens.icons.defaultFile}.png`, { render: { svg, size } });
    }
  }

  const committed = fs.readdirSync(iconsDir).sort();
  const missing = [...files.keys()].filter((name) => !committed.includes(name));
  const extra = committed.filter((name) => !files.has(name));
  const drift = [];

  for (const [name, expected] of files) {
    const file = path.join(iconsDir, name);
    if (!fs.existsSync(file)) continue;
    const actual = fs.readFileSync(file);
    const wanted = expected.contents !== undefined
      ? Buffer.from(expected.contents, 'utf8')
      : await sharp(Buffer.from(expected.render.svg)).resize(expected.render.size, expected.render.size).png().toBuffer();
    if (!actual.equals(wanted)) drift.push(name);
  }

  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
  if (extra.length) problems.push(`unexpected: ${extra.join(', ')}`);
  if (drift.length) problems.push(`not generated from current tokens: ${drift.join(', ')}`);

  if (problems.length) {
    console.error('❌ Icons are out of sync with the AN5 brand tokens.');
    for (const problem of problems) console.error(`   ${problem}`);
    console.error('\n   Fix with: npm run generate:icons');
    process.exit(1);
  }

  console.log(`✅ ${committed.length} icons match the AN5 brand tokens`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});