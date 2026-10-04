#!/usr/bin/env node
/**
 * Regenerate this extension's icons from the shared AN5 brand tokens.
 *
 * The generator lives in the an5Brand submodule so every AN5 repository produces
 * the same artwork from one source. Icons stay committed in ./icons, so building
 * or packaging the extension never needs the submodule — only regeneration does.
 *
 * Usage: node scripts/generate-icons.js [--sizes 16,24,32] [--no-png]
 */

const path = require('path');
const { loadBrand } = require('./brand');

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

async function main() {
  const { brandRoot, brand } = loadBrand();
  const options = { outDir: ICONS_DIR };

  const argv = process.argv.slice(2);
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sizes') options.sizes = argv[++i].split(',').map(Number);
    else if (argv[i] === '--no-png') options.png = false;
    else if (argv[i] === '--quiet') quiet = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  options.quiet = quiet;

  if (!quiet) console.log(`🎨 Using AN5 brand tokens from ${brandRoot}\n`);
  const { count } = await brand.generate(options);
  if (!quiet) console.log(`\n✨ Generated ${count} icon files in ${ICONS_DIR}`);
}

main().catch((err) => {
  console.error('❌ Error generating icons:', err.message);
  process.exit(1);
});