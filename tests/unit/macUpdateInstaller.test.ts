import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildInstallScript,
  normalizeSha512,
  selectVerifiedUpdateAsset,
  verifyFileSha512,
} from '../../electron/macUpdateInstaller.cjs';

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

  it('cleans up the extracted app and downloaded zip after a successful install', () => {
    const script = buildInstallScript({
      sourceAppPath: '/tmp/noa-update-abc/extracted/Noa.app',
      targetAppPath: '/Applications/Noa.app',
      backupAppPath: '/Applications/Noa.app.backup.123',
      extractDir: '/tmp/noa-update-abc/extracted',
      zipPath: '/tmp/noa-update-abc/update.zip',
      logPath: '/tmp/noa-update-abc/install.log',
      appPid: 1234,
      releasePageUrl: 'https://github.com/rickkwang/Noa/releases',
    });

    const successBranch = script.slice(script.indexOf('if /usr/bin/open -a "$TARGET_APP"; then'));
    const cleanupLine = successBranch.split('\n').find((line) => line.includes('rm -rf "$EXTRACT_DIR"'));
    expect(cleanupLine).toBeDefined();
    expect(script).toContain('EXTRACT_DIR=\'/tmp/noa-update-abc/extracted\'');
    expect(script).toContain('ZIP_PATH=\'/tmp/noa-update-abc/update.zip\'');

    const errorHandler = script.slice(script.indexOf('on_error()'), script.indexOf('trap on_error ERR'));
    expect(errorHandler).toContain('rm -rf "$EXTRACT_DIR" "$ZIP_PATH"');

    const launchFailureBranch = script.slice(script.indexOf('else\n  echo "[noa-update] unable to launch installed app"'));
    expect(launchFailureBranch).toContain('rm -rf "$EXTRACT_DIR" "$ZIP_PATH"');
  });

  it('removes its temp working directory when the update aborts before install', async () => {
    const fakeAppDir = await mkdtemp(join(tmpdir(), 'noa-fake-app-'));
    tempDirs.push(fakeAppDir);
    const app = {
      getVersion: () => '1.0.0',
      getName: () => 'Noa',
      getPath: () => join(fakeAppDir, 'Noa.app', 'Contents', 'MacOS', 'Noa'),
    };

    const listWorkDirs = async () => {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(tmpdir());
      return entries.filter((name) => name.startsWith('noa-update-')).sort();
    };

    const before = await listWorkDirs();
    const { installMacUpdate } = await import('../../electron/macUpdateInstaller.cjs');
    await expect(
      installMacUpdate({ app, updateInfo: { version: '9.9.9', files: [] }, onProgress: () => {} }),
    ).rejects.toThrow(/trusted ZIP/);
    expect(await listWorkDirs()).toEqual(before);
  });

});
