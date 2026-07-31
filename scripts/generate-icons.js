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
  const padding = Math.max(1, Math.round(size * 0.083));
  const innerSize = size - padding * 2;
  const rx = Math.max(1, Math.round(size * 0.166));
  const strokeWidth = Math.max(1, (size * 0.0625).toFixed(1));
  const fontSize = (size * 0.38).toFixed(1);
  const yPos = (size * 0.645).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <!-- AN5 Text Badge Container -->
  <rect x="${padding}" y="${padding}" width="${innerSize}" height="${innerSize}" rx="${rx}" fill="#0F172A" stroke="#06B6D4" stroke-width="${strokeWidth}"/>
  <!-- AN5 Text -->
  <text x="${size / 2}" y="${yPos}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="900" fill="#38BDF8" text-anchor="middle" letter-spacing="-0.5">AN5</text>
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
