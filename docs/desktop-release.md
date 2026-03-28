# Desktop Release (macOS Apple Silicon)

## Scope
- Target architecture: `arm64` (Apple Silicon)
- Packaging: `.dmg` + `.zip`
- Update channel: GitHub Releases (`beta` prerelease)

## Local Commands
- `npm run desktop:dev` — run Vite + Electron in development.
- `npm run desktop:build` — generate unpacked app for local validation.
- `npm run desktop:pack:mac` — produce local mac installers in `release/`.
- `npm run desktop:publish:beta` — build and publish to GitHub Releases.

## Required Environment Variables
- `GH_TOKEN` — GitHub token with release publish permission.
- `GH_OWNER`, `GH_REPO` — update feed repository coordinates.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization credentials.
- `CSC_LINK`, `CSC_KEY_PASSWORD` — Developer ID Application certificate for codesign.

## CI Workflow
Workflow file: `.github/workflows/desktop-beta.yml`

Trigger:
- Manual (`workflow_dispatch`) or tag push (`v*`).

Pipeline:
1. `npm ci`
2. `npm run lint`
3. `npm run build:budget`
4. `npm run test:smoke`
5. `npm run desktop:publish:beta`

## Rollback
If a P0 issue appears (data loss, boot failure, import/export unavailable):
1. Mark latest beta release as pre-release hidden or remove assets.
2. Re-publish previous healthy beta assets as current prerelease.
3. Keep release notes with incident and mitigation.
