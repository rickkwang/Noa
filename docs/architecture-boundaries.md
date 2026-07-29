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

## Vault Sync Invariants
- `vaultBaseText` is the exact UTF-8 payload last read or confirmed on disk for dirty or non-canonical rows, including a BOM when present. Preserve it across local mutations and byte-preserving rename/move operations; clear it only after a confirmed canonical write.
- Conflict copies are write-once. An existing conflict path may be reused only when its payload is byte-identical; user-edited conflict files must never be overwritten.

## UI Layer
- `DataSettings` is an orchestration shell for message + confirm states.
- `WorkspaceSection`, `BackupSection`, `ImportSection` render controls only.

## Guardrails
- CI runs `npm run check:structure` to prevent App layer from importing low-level FS modules.
- Any new module should preserve single responsibility and avoid cyclic dependencies.
