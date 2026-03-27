import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appPath = join(process.cwd(), 'src', 'App.tsx');
const appSource = readFileSync(appPath, 'utf8');

const failures = [];

if (appSource.includes("from './lib/fileSystemStorage'")) {
  failures.push('App.tsx must not import from lib/fileSystemStorage directly. Use useFileSync instead.');
}

if (appSource.includes("from './services/fileSyncService'")) {
  failures.push('App.tsx must not import fileSyncService directly. Keep sync logic in useFileSync.');
}

if (appSource.includes("from './lib/dataIntegrity'")) {
  failures.push('App.tsx must not import from lib/dataIntegrity directly. Use useDataTransfer instead.');
}

if (appSource.includes("from './lib/exportTimestamp'")) {
  failures.push('App.tsx must not import from lib/exportTimestamp directly. Use useDataTransfer instead.');
}

if (appSource.includes("from './lib/export'")) {
  failures.push('App.tsx must not import from lib/export directly. Use useDataTransfer instead.');
}

if (appSource.includes("from './lib/storage'")) {
  failures.push('App.tsx must not import from lib/storage directly. Use hooks instead.');
}

if (failures.length > 0) {
  console.error('Architecture check failed:');
  failures.forEach((msg) => console.error(` - ${msg}`));
  process.exit(1);
}

console.log('Architecture check passed.');
