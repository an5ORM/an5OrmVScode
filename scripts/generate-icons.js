#!/usr/bin/env node
/**
 * Regenerate this extension's icons from the shared AN5 brand tokens.
 *
 * The generator lives in the an5Brand submodule so every AN5 repository produces
 * the same artwork from one source. Icons stay committed in ./icons, so building
 * or packaging the extension never needs the submodule — only regeneration does.
 *
 * Usage: node scripts/generate-icons.js [--sizes 16,24,32] [--no-png]
 *
 * Set AN5_BRAND_PATH to point at an an5Brand checkout outside the monorepo.
 */

const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

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
  const brand = require(path.join(brandRoot, 'scripts', 'generate-icons.js'));

  const argv = process.argv.slice(2);
  const options = { outDir: ICONS_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sizes') options.sizes = argv[++i].split(',').map(Number);
    else if (argv[i] === '--no-png') options.png = false;
    else if (argv[i] === '--quiet') options.quiet = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }

  console.log(`🎨 Using AN5 brand tokens from ${brandRoot}\n`);
  const { count } = await brand.generate(options);
  console.log(`\n✨ Generated ${count} icon files in ${ICONS_DIR}`);
}

main().catch((err) => {
  console.error('❌ Error generating icons:', err.message);
  process.exit(1);
});