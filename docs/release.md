# Release Guide

Noa uses a stability-first rollout process for personal and friends-only use.

## Channels
- `dev`: daily development build, unstable by default.
- `beta`: friends-only internal testing build.
- `stable`: personal primary-use build.

## Promotion Gates
### `dev -> beta`
- `npm run lint` passes
- `npm run build:budget` passes
- `npm run test:smoke` passes
- `npm audit --audit-level=high` passes in CI
- No open P0 security or data-integrity bugs

### `beta -> stable`
- 7 consecutive days with no data-loss incidents
- No known P0 bugs
- P1 bugs tracked with mitigation notes

## Pre-Release Checklist
1. Confirm the in-app data ownership notice is visible.
2. Export a JSON backup and verify it opens.
3. Export a ZIP vault and verify note count roughly matches the workspace.
4. Confirm the latest successful filesystem sync timestamp if sync is enabled.
5. Verify backup health and last export timestamp are current.
6. Run `npm run lint`, `npm run build:budget`, and `npm run test:smoke`.
7. Generate the release evidence artifact:

```bash
LINT_STATUS=pass BUILD_BUDGET_STATUS=pass SMOKE_STATUS=pass node scripts/release-evidence.mjs
```

## Desktop Release
- Platform: macOS Apple Silicon (`arm64`)
- Outputs: `.dmg` and `.zip`
- Workflow: `.github/workflows/desktop-release.yml`
- CI steps:
  1. `npm ci`
  2. `npm run lint`
  3. `npm run build:budget`
  4. `npm run test:smoke`
  5. Build and upload desktop release assets

## Rollback
- Keep the previous healthy `beta` and `stable` artifacts.
- If a P0 issue appears, roll back to the last known healthy release immediately.
- P0 triggers: confirmed data loss, app boot failure, or import/export unavailable for normal use.
- Record the root cause and add a regression test after rollback.
