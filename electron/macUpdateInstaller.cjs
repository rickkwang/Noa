const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const GITHUB_OWNER = 'rickkwang';
const GITHUB_REPO = 'Noa';
const TRUSTED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function isTrustedUpdateUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return TRUSTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getReleasePageUrl(version) {
  if (!version) return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${version}`;
}

function getReleaseAssetUrl(version, assetName) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(assetName)}`;
}

function buildFallbackAssetNames(version, productName) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return [
    `${productName}-${version}-${arch}-mac.zip`,
    `${productName}-${version}-${arch}.zip`,
    `${GITHUB_REPO}-${version}-${arch}-mac.zip`,
    `${GITHUB_REPO}-${version}-${arch}.zip`,
  ];
}

async function fetchReleaseByTag(version) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/v${encodeURIComponent(version)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${GITHUB_REPO} updater`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with status ${response.status}`);
  }
  return response.json();
}

function selectZipAsset(assets, version, productName) {
  const zipAssets = (assets || []).filter((asset) => asset && typeof asset.name === 'string' && asset.name.endsWith('.zip') && typeof asset.browser_download_url === 'string');
  if (zipAssets.length === 0) return null;

  const preferredNames = buildFallbackAssetNames(version, productName);
  for (const name of preferredNames) {
    const match = zipAssets.find((asset) => asset.name === name);
    if (match) return match;
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const archMatch = zipAssets.find((asset) => asset.name.includes(arch));
  if (archMatch) return archMatch;

  return zipAssets[0];
}

async function resolveMacUpdateAssetUrl({ version, updateInfo, productName }) {
  const candidates = [];
  if (updateInfo?.path) candidates.push(updateInfo.path);
  for (const file of updateInfo?.files || []) {
    if (file?.url) candidates.push(file.url);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^https?:\/\//i.test(candidate)) {
      if (isTrustedUpdateUrl(candidate)) return candidate;
      continue;
    }
    const assetName = path.posix.basename(candidate);
    if (assetName.endsWith('.zip')) {
      return getReleaseAssetUrl(version, assetName);
    }
  }

  const release = await fetchReleaseByTag(version);
  const asset = selectZipAsset(release?.assets, version, productName);
  if (asset) return asset.browser_download_url;

  for (const assetName of buildFallbackAssetNames(version, productName)) {
    return getReleaseAssetUrl(version, assetName);
  }

  throw new Error('Unable to resolve a GitHub release asset for this macOS update.');
}

function downloadFileWithProgress(sourceUrl, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    let resStream = null;
    let fileStream = null;

    const cleanup = () => {
      if (resStream) {
        resStream.removeAllListeners();
        resStream.resume();
        resStream = null;
      }
      if (fileStream) {
        fileStream.removeAllListeners();
        fileStream.destroy();
        fileStream = null;
      }
    };

    const request = (urlString, redirectCount = 0) => {
      if (!isTrustedUpdateUrl(urlString)) {
        reject(new Error('Blocked untrusted download URL.'));
        return;
      }

      const requestUrl = new URL(urlString);
      const req = https.get(requestUrl, (res) => {
        resStream = res;

        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectCount >= 5) {
            cleanup();
            reject(new Error('Too many redirects while downloading update.'));
            return;
          }
          const redirectUrl = new URL(res.headers.location, requestUrl).toString();
          cleanup();
          request(redirectUrl, redirectCount + 1);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          cleanup();
          reject(new Error(`Download failed with status ${res.statusCode || 'unknown'}`));
          return;
        }

        const total = Number(res.headers['content-length'] || 0);
        let downloaded = 0;
        fileStream = fs.createWriteStream(outputPath);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (typeof onProgress === 'function' && total > 0) {
            const percent = Math.max(1, Math.min(100, Math.round((downloaded / total) * 100)));
            onProgress(percent);
          }
        });

        res.on('error', () => {
          cleanup();
          reject(new Error('Download stream error.'));
        });

        fileStream.on('error', () => {
          cleanup();
          reject(new Error('File write error.'));
        });

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(outputPath));
        });

        res.pipe(fileStream);
      });

      req.on('error', () => {
        cleanup();
        reject(new Error('Request failed.'));
      });
    };

    request(sourceUrl);
  });
}

function extractZipArchive(zipPath, extractDir) {
  const result = spawnSync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const errorText = (result.stderr || result.stdout || 'Unable to extract update package.').trim();
    throw new Error(errorText);
  }
}

function findAppBundle(dir, appName) {
  const direct = path.join(dir, `${appName}.app`);
  if (fs.existsSync(direct)) return direct;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.name.endsWith('.app')) return entryPath;
    const nested = findAppBundle(entryPath, appName);
    if (nested) return nested;
  }
  return null;
}

function getCurrentAppBundlePath(app) {
  const executablePath = app.getPath('exe');
  return path.resolve(path.dirname(path.dirname(path.dirname(executablePath))));
}

function buildInstallScript({ sourceAppPath, targetAppPath, backupAppPath, logPath, appPid, releasePageUrl }) {
  return `#!/bin/bash
set -euo pipefail

SOURCE_APP=${shellQuote(sourceAppPath)}
TARGET_APP=${shellQuote(targetAppPath)}
BACKUP_APP=${shellQuote(backupAppPath)}
LOG_FILE=${shellQuote(logPath)}
RELEASE_PAGE_URL=${shellQuote(releasePageUrl)}
APP_PID=${appPid}

exec >>"$LOG_FILE" 2>&1
echo "[noa-update] started at $(date)"

restore_backup() {
  if [ -d "$BACKUP_APP" ]; then
    if [ -d "$TARGET_APP" ]; then
      /bin/rm -rf "$TARGET_APP" || true
    fi
    mv "$BACKUP_APP" "$TARGET_APP" || true
  fi
}

on_error() {
  code=$?
  echo "[noa-update] failed with code $code"
  restore_backup
  /usr/bin/open "$RELEASE_PAGE_URL" >/dev/null 2>&1 || true
  exit "$code"
}

trap on_error ERR

if [ ! -d "$SOURCE_APP" ]; then
  echo "[noa-update] source app missing"
  exit 11
fi

for _ in {1..150}; do
  if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if kill -0 "$APP_PID" >/dev/null 2>&1; then
  echo "[noa-update] app still running after timeout"
  exit 21
fi

if [ -d "$TARGET_APP" ]; then
  mv "$TARGET_APP" "$BACKUP_APP"
fi

/usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"
/usr/bin/xattr -rd com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true

if /usr/bin/open -a "$TARGET_APP"; then
  /bin/rm -rf "$BACKUP_APP" >/dev/null 2>&1 || true
  echo "[noa-update] install completed"
else
  echo "[noa-update] unable to launch installed app"
  restore_backup
  /usr/bin/open "$RELEASE_PAGE_URL" >/dev/null 2>&1 || true
  exit 31
fi
`;
}

function spawnDetachedInstallScript(scriptPath) {
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function installMacUpdate({ app, updateInfo, onProgress }) {
  const version = updateInfo?.version || app.getVersion();
  const productName = app.getName();
  const releasePageUrl = getReleasePageUrl(version);
  const targetAppPath = getCurrentAppBundlePath(app);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noa-update-'));
  const zipPath = path.join(workDir, 'update.zip');
  const extractDir = path.join(workDir, 'extracted');
  const logPath = path.join(workDir, 'install.log');
  fs.mkdirSync(extractDir, { recursive: true });

  const downloadUrl = await resolveMacUpdateAssetUrl({ version, updateInfo, productName });
  await downloadFileWithProgress(downloadUrl, zipPath, onProgress);
  extractZipArchive(zipPath, extractDir);

  const sourceAppPath = findAppBundle(extractDir, productName);
  if (!sourceAppPath) {
    throw new Error(`Extracted update package does not contain ${productName}.app.`);
  }

  const backupAppPath = `${targetAppPath}.backup.${Date.now()}`;
  const scriptPath = path.join(workDir, 'install.sh');
  fs.writeFileSync(
    scriptPath,
    buildInstallScript({
      sourceAppPath,
      targetAppPath,
      backupAppPath,
      logPath,
      appPid: process.pid,
      releasePageUrl,
    }),
    'utf8',
  );
  fs.chmodSync(scriptPath, 0o755);
  spawnDetachedInstallScript(scriptPath);

  return {
    ok: true,
    reason: 'external-installer-started',
    message: `Downloaded v${version}. Restarting to install...`,
    version,
    logPath,
  };
}

module.exports = {
  getReleasePageUrl,
  installMacUpdate,
};
