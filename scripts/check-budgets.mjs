import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
const ENTRY_BUDGET_BYTES = 400 * 1024;
const MAX_CHUNK_BYTES = 1300 * 1024;
const CHUNK_WARNING_LIMIT_BYTES = 500 * 1024;

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

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'dist', '.vite', 'manifest.json'), 'utf8'));
const entryKeys = Object.keys(manifest).filter((key) => manifest[key].isEntry);
const entryNames = new Set(entryKeys.map((key) => basename(manifest[key].file)));
const entryAssets = jsAssets.filter((asset) => entryNames.has(asset.name));
if (entryAssets.length === 0) {
  console.error('Budget check failed: no entry JS chunk found.');
  process.exit(1);
}

const oversizedEntry = entryAssets.filter((asset) => asset.size > ENTRY_BUDGET_BYTES);
const oversizedChunks = jsAssets.filter((asset) => asset.size > MAX_CHUNK_BYTES);
const warningSizedChunks = jsAssets.filter((asset) => asset.size > CHUNK_WARNING_LIMIT_BYTES);

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

const staticNames = new Set();
function collectStaticImports(key) {
  const chunk = manifest[key];
  const name = basename(chunk.file);
  if (staticNames.has(name)) return;
  staticNames.add(name);
  (chunk.imports ?? []).forEach(collectStaticImports);
}
entryKeys.forEach(collectStaticImports);
const staticAssets = jsAssets.filter((asset) => staticNames.has(asset.name));
const staticBytes = staticAssets.reduce((total, asset) => total + asset.size, 0);
const staticGzipBytes = staticAssets.reduce((total, asset) => (
  total + gzipSync(readFileSync(join(DIST_ASSETS, asset.name))).length
), 0);

console.log('Budget check passed.');
console.log(`Entry + static imports (JS): ${(staticBytes / 1024).toFixed(1)}KiB raw / ${(staticGzipBytes / 1024).toFixed(1)}KiB gzip`);
jsAssets.forEach((asset) => {
  const label = entryNames.has(asset.name) ? 'entry' : staticNames.has(asset.name) ? 'static' : 'other';
  console.log(` - [${label}] ${asset.name}: ${(asset.size / 1024).toFixed(1)}KB`);
});
if (warningSizedChunks.length > 0) {
  console.log('Warning-sized chunks (non-fatal):');
  warningSizedChunks.forEach((asset) => {
    console.log(` - ${asset.name}: ${(asset.size / 1024).toFixed(1)}KB`);
  });
}
