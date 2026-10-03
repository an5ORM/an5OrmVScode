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
  <defs>
    <linearGradient id="an5-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#6366F1"/>
    </linearGradient>
  </defs>
  <!-- AN5 Badge matching exact header proportions and radius -->
  <rect x="5" y="24" width="90" height="52" rx="8" ry="8" fill="url(#an5-gradient)"/>
  <!-- AN5 Text optically & mathematically centered -->
  <text x="50.5" y="62" font-family="Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#FFFFFF" text-anchor="middle">AN5</text>
</svg>
`;
}

async function main() {
  console.log('🚀 Generating AN5 icons in multiple SVG & PNG sizes...\n');

  // The Activity Bar renders SVGs as monochrome masks; brand letters must be transparent.
  fs.writeFileSync(path.join(ICONS_DIR, 'activity.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24">\n  <!-- AN5 brand proportions; knockout letters remain visible in VS Code\'s monochrome icon mask. -->\n  <defs>\n    <mask id="an5-letters" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">\n      <rect x="5" y="5" width="90" height="90" rx="20" fill="white"/>\n      <text x="50.5" y="62" font-family="Arial, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, sans-serif" font-size="34" font-weight="800" text-anchor="middle" fill="black">AN5</text>\n    </mask>\n  </defs>\n  <rect x="5" y="5" width="90" height="90" rx="20" fill="#c5c5c5" mask="url(#an5-letters)"/>\n</svg>\n');

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
