# I–M F2-FS-01 public-owner bridge

## Contract

- Baseline: `fae8b70:tests/browser/f2-files-split.spec.js`, F2-FS-01.
- User capability: open the channel Files surface while keeping the dynamic
  conversation and Composer usable beside it; close Files and return to the
  dynamic route.
- Invariant: Files and conversation share the current Shell layout/navigation;
  opening Files must not replace or discard the public conversation surface.
- Current owner: `WorkspaceLayout` owns the split topology and route, while
  `FilesFeature` owns the public Files surface. The Composer and dynamic
  conversation remain the existing `ConversationSurface` owner.

## Allowed boundary and bounded failure

This bridge edits only the existing browser contract file and this audit. No
product change is needed unless the public scenario exposes a real regression;
then the only candidate owner files are `src/app/WorkspaceLayout.jsx` and
`src/ui/features/files/FilesFeature.jsx`. A missing/unavailable file listing
must remain an honest Files loading/error state; it must not hide the dynamic
surface or introduce a second route/store.

## Migration

The old `artifacts` tab/route assertions are replaced by public current
observables: both `频道文件` and `频道动态` regions are visible, the public
`消息` textbox remains usable, and the current `files`/`conversation` routes
are selected. The first run exposed only the obsolete old `dynamic` route
literal; it was replaced with the current public `conversation` route. No
private helper or implementation-only geometry is asserted.

## Evidence

- Base: `b9452f20b0c030ad63356d234d5e8aa4041c5024`.
- Worktree: `.worktrees/im-f3-math-markdown-b9452f2` (detached).
- Focused browser command: `playwright test tests/browser/f2-files-split.spec.js
  --grep 'F2-FS-01' --repeat-each=3` → **3 passed**.
- Full current file command: `playwright test
  tests/browser/f2-files-split.spec.js` → **7 passed**.
- Files owner unit command: `vitest run tests/file-browser.test.jsx` → **15
  passed**.
- Production build: `npm run build` → **passed** (existing chunk-size warning
  only).
