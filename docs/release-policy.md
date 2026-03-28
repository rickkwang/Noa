# Release Policy (Inner Beta)

Noa uses three channels for controlled rollout:

## Channels
- `dev`: Daily development build. Unstable by default.
- `beta`: Friends-only internal testing build. Must pass CI + smoke tests.
- `stable`: Personal primary-use build. Must pass beta for 7 days without P0 incidents.

## Promotion Gates
1. `dev -> beta`
- `npm run lint` passes
- `npm run build:budget` passes
- `npm run test:smoke` passes
- No open P0 security/data-integrity bugs

2. `beta -> stable`
- 7 consecutive days with no data-loss incidents
- No known P0 bugs
- P1 bugs are tracked with mitigation notes

## Rollback Strategy
- Keep the previous `beta` and `stable` build artifacts with version tags.
- If a P0 issue is reported, immediately roll back to the last known healthy artifact.
- P0 rollback triggers: confirmed data loss, app boot failure, or import/export unavailable for normal use.
- Post-rollback, record incident root cause and add a regression test.
