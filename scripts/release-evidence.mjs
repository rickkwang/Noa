import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gitSha = safeExec('git rev-parse HEAD');
const gitBranch = safeExec('git rev-parse --abbrev-ref HEAD');

const evidence = {
  generatedAt: new Date().toISOString(),
  appVersion: pkg.version ?? 'unknown',
  git: {
    sha: gitSha,
    branch: gitBranch,
  },
  environment: {
    node: process.version,
    platform: process.platform,
  },
  gates: {
    lint: process.env.LINT_STATUS ?? 'unknown',
    buildBudget: process.env.BUILD_BUDGET_STATUS ?? 'unknown',
    smoke: process.env.SMOKE_STATUS ?? 'unknown',
  },
};

const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
const fileName = `release-evidence-${evidence.generatedAt.replace(/[:.]/g, '-')}.json`;
const outputPath = path.join(releaseDir, fileName);
fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
console.log(`Release evidence written to ${outputPath}`);
