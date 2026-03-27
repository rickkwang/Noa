import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
const ENTRY_BUDGET_BYTES = 400 * 1024;
const MAX_CHUNK_BYTES = 1300 * 1024;

function getJsAssets(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const path = join(dir, name);
      return { name, size: statSync(path).size };
    });
}

const jsAssets = getJsAssets(DIST_ASSETS);
if (jsAssets.length === 0) {
  console.error('Budget check failed: no JS assets found in dist/assets.');
  process.exit(1);
}

const entryAssets = jsAssets.filter((asset) => asset.name.startsWith('index-'));
if (entryAssets.length === 0) {
  console.error('Budget check failed: no entry JS chunk found.');
  process.exit(1);
}

const oversizedEntry = entryAssets.filter((asset) => asset.size > ENTRY_BUDGET_BYTES);
const oversizedChunks = jsAssets.filter((asset) => asset.size > MAX_CHUNK_BYTES);

if (oversizedEntry.length > 0 || oversizedChunks.length > 0) {
  console.error('Budget check failed.');
  if (oversizedEntry.length > 0) {
    console.error('Entry chunk exceeds 400KB raw size:');
    oversizedEntry.forEach((asset) => {
      console.error(` - ${asset.name}: ${(asset.size / 1024).toFixed(1)}KB`);
    });
  }
  if (oversizedChunks.length > 0) {
    console.error('Chunk exceeds 1300KB raw size:');
    oversizedChunks.forEach((asset) => {
      console.error(` - ${asset.name}: ${(asset.size / 1024).toFixed(1)}KB`);
    });
  }
  process.exit(1);
}

console.log('Budget check passed.');
jsAssets.forEach((asset) => {
  const label = asset.name.startsWith('index-') ? 'entry' : 'lazy';
  console.log(` - [${label}] ${asset.name}: ${(asset.size / 1024).toFixed(1)}KB`);
});
