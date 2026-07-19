// dependency-cruiser configuration.
//
// Replaces the old string-based scripts/check-architecture.mjs with AST-level
// enforcement of the App.tsx → hooks → services/lib layering rule.
//
// Key rules (matching AGENTS.md):
//   1. App.tsx must NOT import directly from:
//      - lib/fileSystemStorage, lib/dataIntegrity, lib/exportTimestamp,
//        lib/export, lib/storage, lib/backupDirectoryStorage
//      - services/fileSyncService, services/autoBackupService
//      UI must go through hooks (useFileSync, useDataTransfer, useAutoBackup, etc.).
//   2. General layering: components/ may use hooks/, lib/, services/, core/.
//      hooks/ may use lib/, services/, core/. lib/ should not reach back into
//      hooks/ or components/ (no cycles upward).

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended',

  forbidden: [
    // ─── App.tsx must go through hooks — mirror of AGENTS.md hard rule ───
    {
      name: 'app-shell-must-use-hooks',
      severity: 'error',
      from: { path: '^src/App\\.tsx$' },
      to: {
        path: [
          '^src/lib/fileSystemStorage\\.ts$',
          '^src/lib/dataIntegrity\\.ts$',
          '^src/lib/exportTimestamp\\.ts$',
          '^src/lib/export\\.ts$',
          '^src/lib/storage\\.ts$',
          '^src/lib/backupDirectoryStorage\\.ts$',
          '^src/services/fileSyncService\\.ts$',
          '^src/services/autoBackupService\\.ts$',
        ],
      },
      comment:
        'App.tsx must not import storage/sync/data-integrity modules directly — go through hooks (useFileSync, useDataTransfer, useAutoBackup). This is the AGENTS.md hard rule, previously enforced by a string-`includes` script that aliases could bypass.',
    },

    // ─── Override recommended's not-to-unresolvable to allow type-only and
    //     dynamic-import virtual modules that the static resolver can't follow. ───
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: [
          '^vite/client$', // vite ambient type declaration
          '^mdast$', // @types/mdast type-only
          '^mermaid$', // dynamic import('mermaid')
        ],
      },
    },

    // ─── No upward cycles: lib/ must not import from hooks/ or components/ ───
    {
      name: 'lib-no-upward-imports',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: ['^src/hooks/', '^src/components/'] },
      comment:
        'lib/ is the lowest layer; it must not reach back up into hooks/ or components/.',
    },

    // ─── services/ must not import from hooks/ or components/ ───
    {
      name: 'services-no-upward-imports',
      severity: 'error',
      from: { path: '^src/services/' },
      to: { path: ['^src/hooks/', '^src/components/'] },
    },

    // ─── core/ must stay pure: no UI, no hooks, no services ───
    {
      name: 'core-stays-pure',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: ['^src/hooks/', '^src/components/', '^src/services/'] },
      comment: 'core/ (search engine) must remain UI- and side-effect-free.',
    },

    // ─── Orphan modules (not reachable from entry points) ───
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['^src/types\\.ts$', '^src/types/', '\\.d\\.ts$'] },
    },
  ],

  options: {
    doNotFollow: {
      path: [
        'node_modules',
        '^dist/',
        '^release/',
        '^output/',
        '^\\.worktrees/',
        // Type-only ambient modules — not real runtime dependencies
        '^src/vite-env\\.d\\.ts$',
        '^src/electron-env\\.d\\.ts$',
        '^src/web-apis\\.d\\.ts$',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx'],
    },
    // Exclude dynamic imports and type-only virtual modules from resolution
    // checks — these are valid at runtime but dependency-cruiser's static
    // analysis flags them as unresolvable.
    exoticRequireStrings: [],
  },
};
