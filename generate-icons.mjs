#!/usr/bin/env node
/**
 * Generate PWA icons as SVG files.
 * Run: node generate-icons.mjs
 * Then convert to PNG with: npx sharp-cli (or use any SVG→PNG tool)
 *
 * Or simply use the SVG files directly if your PWA setup supports it.
 */
import { writeFileSync, mkdirSync } from 'fs';

const sizes = [192, 512];
const dir = './public/icons';
mkdirSync(dir, { recursive: true });

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#070B14"/>
  <g transform="translate(${size/2},${size/2})">
    <!-- Hexagon -->
    <polygon points="0,${-size*0.3} ${size*0.26},${-size*0.15} ${size*0.26},${size*0.15} 0,${size*0.3} ${-size*0.26},${size*0.15} ${-size*0.26},${-size*0.15}"
      fill="none" stroke="#00C896" stroke-width="${size*0.03}" stroke-linejoin="round"/>
    <!-- Inner lines -->
    <line x1="0" y1="${-size*0.3}" x2="0" y2="0" stroke="rgba(0,200,150,0.4)" stroke-width="${size*0.015}" stroke-linecap="round"/>
    <line x1="0" y1="0" x2="${size*0.26}" y2="${-size*0.15}" stroke="rgba(0,200,150,0.4)" stroke-width="${size*0.015}" stroke-linecap="round"/>
    <!-- L text -->
    <text x="${-size*0.08}" y="${size*0.1}" font-family="sans-serif" font-weight="800" font-size="${size*0.28}" fill="#E2DDD0">L</text>
  </g>
</svg>`;

for (const size of sizes) {
  writeFileSync(`${dir}/icon-${size}.svg`, svg(size));
  console.log(`✓ icon-${size}.svg`);
}

console.log('\nTo convert to PNG, run:');
console.log('  npx sharp-cli -i public/icons/icon-192.svg -o public/icons/icon-192.png');
console.log('  npx sharp-cli -i public/icons/icon-512.svg -o public/icons/icon-512.png');
