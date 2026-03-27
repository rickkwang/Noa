# Architecture Boundaries

## App Layer (`App.tsx`)
- Responsibility: compose page-level UI and wire feature hooks.
- Must not directly call low-level file-system storage functions.
- Must not include note persistence details or import/export data transformation logic.

## Domain Hooks
- `useNotes`: note/folder/task domain state and persistence bridge.
- `useFileSync`: filesystem sync state machine (`idle | syncing | ready | error`) and retry behavior.
- `useGlobalShortcuts`: keyboard-only interaction orchestration.
- `useDataTransfer`: import/export/connect/disconnect use-cases and integrity-aware transfer flow.

## Service Layer
- `fileSyncService`: all file-sync primitives and error classification.
- UI components consume hooks and should not call service functions directly.

## UI Layer
- `DataSettings` is an orchestration shell for message + confirm states.
- `WorkspaceSection`, `BackupSection`, `ImportSection` render controls only.

## Guardrails
- CI runs `npm run check:structure` to prevent App layer from importing low-level FS modules.
- Any new module should preserve single responsibility and avoid cyclic dependencies.
