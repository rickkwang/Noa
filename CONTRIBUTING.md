# Contributing to Noa

Thanks for helping improve Noa.

## Development setup

1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. Use `npm run lint` to type-check before opening a PR.

## Testing

- Run `npm run test:unit` for unit coverage.
- Run `npm run test:smoke` for Playwright coverage.
- If you touch release or packaging logic, also run `npm run build:budget`.

## Pull request guidance

- Keep changes focused on one risk or one feature area.
- Do not change product behavior unless the PR explicitly targets it.
- Include a short summary of what changed and which tests were run.
- Prefer small, reviewable PRs over large mixed-scope changes.

## Code style

- Match the existing TypeScript and React style in the repository.
- Keep edits minimal and avoid unrelated formatting churn.
