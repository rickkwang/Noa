import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyMacUpdateMetadata } from '../../scripts/verify-mac-update-metadata.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createReleaseFixture(version = '1.2.3') {
  const dir = await mkdtemp(join(tmpdir(), 'noa-metadata-test-'));
  tempDirs.push(dir);
  const zipName = `Noa-${version}-arm64-mac.zip`;
  const dmgName = `Noa-${version}-arm64.dmg`;
  const zipContent = 'zip artifact';
  const dmgContent = 'dmg artifact';
  const zipSha = createHash('sha512').update(zipContent).digest('base64');
  const dmgSha = createHash('sha512').update(dmgContent).digest('base64');
  await Promise.all([
    writeFile(join(dir, zipName), zipContent),
    writeFile(join(dir, dmgName), dmgContent),
    writeFile(join(dir, 'package.json'), JSON.stringify({ version })),
    writeFile(join(dir, 'latest-mac.yml'), `version: ${version}\nfiles:\n  - url: ${zipName}\n    sha512: ${zipSha}\n    size: ${Buffer.byteLength(zipContent)}\n  - url: ${dmgName}\n    sha512: ${dmgSha}\n    size: ${Buffer.byteLength(dmgContent)}\npath: ${zipName}\nsha512: ${zipSha}\n`),
  ]);
  return dir;
}

describe('macOS update metadata verification', () => {
  it('verifies the version, size, and SHA-512 of both release artifacts', async () => {
    const dir = await createReleaseFixture();
    await expect(verifyMacUpdateMetadata(
      join(dir, 'latest-mac.yml'),
      join(dir, 'package.json'),
    )).resolves.toMatchObject({ version: '1.2.3' });
  });

  it('rejects a tampered artifact and a mismatched package version', async () => {
    const dir = await createReleaseFixture();
    await writeFile(join(dir, 'Noa-1.2.3-arm64-mac.zip'), 'tampered zip');
    await expect(verifyMacUpdateMetadata(
      join(dir, 'latest-mac.yml'),
      join(dir, 'package.json'),
    )).rejects.toThrow(/size does not match|SHA-512 does not match/);

    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.4' }));
    await expect(verifyMacUpdateMetadata(
      join(dir, 'latest-mac.yml'),
      join(dir, 'package.json'),
    )).rejects.toThrow(/must reference Noa-1.2.4/);
  });
});
