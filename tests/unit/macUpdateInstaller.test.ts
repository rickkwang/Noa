import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeSha512, selectVerifiedUpdateAsset, verifyFileSha512 } from '../../electron/macUpdateInstaller.cjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('macOS update verification', () => {
  it('selects only a trusted ZIP with a valid SHA-512 digest', () => {
    const digest = createHash('sha512').update('zip').digest('base64');
    const asset = selectVerifiedUpdateAsset({
      version: '1.2.3',
      updateInfo: {
        files: [
          { url: 'Noa-1.2.3-arm64.dmg', sha512: digest },
          { url: 'Noa-1.2.3-arm64-mac.zip', sha512: digest },
        ],
      },
    });

    expect(asset.url).toBe('https://github.com/rickkwang/Noa/releases/download/v1.2.3/Noa-1.2.3-arm64-mac.zip');
    expect(asset.sha512).toEqual(normalizeSha512(digest));
  });

  it('rejects missing digests and untrusted hosts', () => {
    expect(() => selectVerifiedUpdateAsset({
      version: '1.2.3',
      updateInfo: { files: [{ url: 'Noa-1.2.3-arm64-mac.zip' }] },
    })).toThrow(/valid SHA-512/);
    expect(() => selectVerifiedUpdateAsset({
      version: '1.2.3',
      updateInfo: {
        files: [{
          url: 'https://evil.example/Noa-1.2.3-arm64-mac.zip',
          sha512: createHash('sha512').update('zip').digest('base64'),
        }],
      },
    })).toThrow(/trusted ZIP/);
  });

  it('verifies the downloaded file digest and rejects tampering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'noa-update-test-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'update.zip');
    await writeFile(filePath, 'trusted update');
    const digest = createHash('sha512').update('trusted update').digest('base64');

    await expect(verifyFileSha512(filePath, digest)).resolves.toBeUndefined();
    await writeFile(filePath, 'tampered update');
    await expect(verifyFileSha512(filePath, digest)).rejects.toThrow(/failed SHA-512/);
  });

});
