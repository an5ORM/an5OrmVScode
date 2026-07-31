#!/usr/bin/env node
/**
 * Script to generate AN5 icons in multiple SVG and PNG sizes.
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

function generateSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <!-- AN5 Text Badge Container -->
  <rect x="8" y="8" width="84" height="84" rx="16" fill="#0F172A" stroke="#06B6D4" stroke-width="6"/>
  <!-- AN5 Text -->
  <text x="50" y="62" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="34" font-weight="900" fill="#38BDF8" text-anchor="middle">AN5</text>
</svg>
`;
}

async function main() {
  console.log('🚀 Generating AN5 icons in multiple SVG & PNG sizes...\n');

  for (const size of SIZES) {
    const svgContent = generateSvg(size);
    const svgFilename = `an5-${size}x${size}.svg`;
    const pngFilename = `an5-${size}x${size}.png`;

    const svgPath = path.join(ICONS_DIR, svgFilename);
    const pngPath = path.join(ICONS_DIR, pngFilename);

    // Save SVG file
    fs.writeFileSync(svgPath, svgContent, 'utf8');

    // Convert SVG to PNG using sharp
    await sharp(Buffer.from(svgContent))
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`  ✓ Generated ${svgFilename} & ${pngFilename}`);

    // Create default an5.svg and an5.png (24x24)
    if (size === 24) {
      fs.writeFileSync(path.join(ICONS_DIR, 'an5.svg'), svgContent, 'utf8');
      await sharp(Buffer.from(svgContent))
        .resize(24, 24)
        .png()
        .toFile(path.join(ICONS_DIR, 'an5.png'));
      console.log(`  ✓ Generated default an5.svg & an5.png (24x24)`);
    }
  }

  console.log(`\n✨ Successfully generated ${SIZES.length * 2 + 2} icon files in ${ICONS_DIR}`);
}

main().catch((err) => {
  console.error('❌ Error generating icons:', err);
  process.exit(1);
});
