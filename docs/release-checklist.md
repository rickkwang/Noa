# 10-Minute Pre-Release Checklist

## 1) Data Safety
- Confirm the in-app data ownership notice is visible: data is browser/device-local only and does not auto-sync across devices.
- Export JSON backup from settings and verify file can be opened.
- Export ZIP backup and verify note count roughly matches current workspace.
- Confirm latest successful local file sync timestamp (if filesystem sync is enabled).
- Verify backup metadata shows the last export timestamp and backup health state.

## 2) Quality Gates
- Run `npm run lint` (blocking)
- Run `npm run build:budget` (blocking)
- Run `npm run test:smoke` (blocking)
- Do not promote to `beta` if any gate above fails.

## 3) Security Quick Check
- Verify Markdown preview does not execute raw HTML/JS payloads.
- Verify exported HTML opens safely and does not execute script tags.

## 4) Known Issues & Decision
- Review open P0/P1 issues.
- Confirm release channel target (`dev`, `beta`, or `stable`) and gate compliance.

## 5) Rollback Readiness
- Ensure previous release artifact is still available.
- Confirm rollback version number and location.
- Rollback trigger (P0): any data-loss report, app cannot boot, or import/export unavailable.
