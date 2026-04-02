/**
 * Generates build/icon.ico and build/icon.png from build/icon.svg
 * Requires: @resvg/resvg-js  to-ico
 */
import { Resvg } from '@resvg/resvg-js';
import toIco from 'to-ico';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'build/icon.svg'));

const sizes = [16, 32, 48, 64, 128, 256];

console.log('Rendering PNG sizes:', sizes.join(', '));

const pngs = sizes.map(size => {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
});

// 256×256 standalone PNG (used by electron-builder on non-Windows)
const resvg256 = new Resvg(svg, {
  fitTo: { mode: 'width', value: 256 },
  background: 'rgba(0,0,0,0)',
});
writeFileSync(resolve(root, 'build/icon.png'), Buffer.from(resvg256.render().asPng()));
console.log('Written: build/icon.png');

// ICO containing all sizes (required for Windows NSIS installer)
const icoBuffer = await toIco(pngs);
writeFileSync(resolve(root, 'build/icon.ico'), icoBuffer);
console.log('Written: build/icon.ico');
