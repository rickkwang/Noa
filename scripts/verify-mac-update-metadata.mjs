import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function calculateSha512(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('base64')));
  });
}

export async function verifyMacUpdateMetadata(metadataPath, packagePath = 'package.json') {
  const source = readFileSync(metadataPath, 'utf8');
  const packageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  const entries = [...source.matchAll(/- url:\s*(.+)\n\s+sha512:\s*(\S+)\n\s+size:\s*(\d+)/g)]
    .map((match) => ({ url: match[1].trim(), sha512: match[2], size: Number(match[3]) }));
  const zip = entries.find((entry) => entry.url.endsWith('.zip'));
  const dmg = entries.find((entry) => entry.url.endsWith('.dmg'));
  const topLevelPath = source.match(/^path:\s*(.+)$/m)?.[1]?.trim();
  const topLevelSha512 = source.match(/^sha512:\s*(\S+)$/m)?.[1];

  if (!zip || !dmg) {
    throw new Error('latest-mac.yml must contain both ZIP and DMG entries.');
  }
  const expectedZip = `Noa-${packageVersion}-arm64-mac.zip`;
  const expectedDmg = `Noa-${packageVersion}-arm64.dmg`;
  if (zip.url !== expectedZip || dmg.url !== expectedDmg) {
    throw new Error(`latest-mac.yml must reference ${expectedZip} and ${expectedDmg}.`);
  }
  const hasValidSha512 = (value) => {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 64 && decoded.toString('base64') === value;
  };
  if (!hasValidSha512(zip.sha512) || !hasValidSha512(dmg.sha512)) {
    throw new Error('latest-mac.yml contains an invalid SHA-512 digest.');
  }
  if (!Number.isSafeInteger(zip.size) || zip.size <= 0 || !Number.isSafeInteger(dmg.size) || dmg.size <= 0) {
    throw new Error('latest-mac.yml contains an invalid artifact size.');
  }
  if (topLevelPath !== zip.url || topLevelSha512 !== zip.sha512) {
    throw new Error('latest-mac.yml must use the ZIP as its primary macOS update artifact.');
  }

  for (const entry of [zip, dmg]) {
    const artifactPath = resolve(dirname(metadataPath), entry.url);
    const actualSize = statSync(artifactPath).size;
    if (actualSize !== entry.size) {
      throw new Error(`${entry.url} size does not match latest-mac.yml.`);
    }
    const actualSha512 = await calculateSha512(artifactPath);
    if (actualSha512 !== entry.sha512) {
      throw new Error(`${entry.url} SHA-512 does not match latest-mac.yml.`);
    }
  }

  return { version: packageVersion, zip: zip.url, dmg: dmg.url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadataPath = process.argv[2];
  const packagePath = process.argv[3] || 'package.json';
  if (!metadataPath) {
    console.error('Usage: node scripts/verify-mac-update-metadata.mjs <latest-mac.yml> [package.json]');
    process.exit(1);
  }
  const result = await verifyMacUpdateMetadata(metadataPath, packagePath);
  console.log(`Verified macOS v${result.version} update artifacts and metadata.`);
}
