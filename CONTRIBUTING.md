# Contributing to Noa

Thanks for helping improve Noa.

## Development setup

Use Node 22, matching CI (`nvm use` reads `.nvmrc`). With Homebrew, install
`node@22` and use `export PATH="$(brew --prefix node@22)/bin:$PATH"` in the
terminal where you work on Noa.

1. Install dependencies with `npm install`.
2. Start the app with `npm run dev` (Vite on :3000).
3. Use `npm run lint` to type-check and lint before committing.

## Testing

- Run `npm run test:unit` for unit coverage.
- Run `npm run test:smoke` for Playwright coverage (boots the dev server).
- If you touch build or packaging logic, also run `npm run build:budget`.
- If you touch `App.tsx` or add lib/service imports in the app shell, also run `npm run check:structure`.

## Pushing to main

Work lands on `main` by direct push — there is no PR gate, so the gate lives
locally instead. `npm install` points `core.hooksPath` at `.githooks/`, and the
pre-push hook runs the same checks CI runs:

```
lint → test:unit → check:structure → build:budget → playwright
```

The hook uses Node 22 (selecting Homebrew's `node@22` when needed) and runs
Playwright in CI mode with one worker, matching the macOS release runner.
It verifies that bundled Chromium can start before using the existing Chrome
fallback.

A push that fails the hook does not leave the machine. Fix the failure and
push again; `NOA_SKIP_PREPUSH=1 git push` bypasses the hook for emergencies.

## Change guidance

- Keep changes focused on one risk or one feature area.
- Do not change product behavior unless the change explicitly targets it.
- Include a short summary of what changed and which tests were run in the commit message.
- Prefer small, reviewable commits over large mixed-scope ones.

## Code style

- Match the existing TypeScript and React style in the repository.
- Keep edits minimal and avoid unrelated formatting churn.
