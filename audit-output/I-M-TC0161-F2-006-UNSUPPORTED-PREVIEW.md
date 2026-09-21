# I–M / TC-0161 (F2-006) exact-path migration

## Case record

- Baseline: `fae8b70:tests/browser/f2-artifacts.spec.js:74`, case
  `F2-006 长文件名与不支持预览安全降级，窄屏无横向溢出`.
- User capability: a user can upload and attach a long-named binary file,
  open the resulting public artifact detail, receive an honest unsupported
  preview instead of fabricated content, keep Download and Close usable, and
  use the detail surface at tablet/mobile widths without horizontal overflow.
- Invariant: the current Files owner remains the only file-list/upload/attach
  path (`FilesFeature` → `useAttachmentTransactions`); the same attachment
  projection opens `ArtifactPreviewPanel` through `WorkspaceRightPanel`.
  Unsupported media is a typed preview result, not a second preview store,
  route, or compatibility parser.
- Baseline setup/action/result: reset the `resource-workflow` mock with seed
  `1202`; log in; open Files; upload a 12-repeat long `.bin` name with four
  binary bytes; attach it from the Files row; send; open the message's public
  attachment action; assert the unsupported notice, tablet/mobile pane
  geometry, no document overflow, and visible download/close controls.
- Current public owner and entry points: `src/ui/features/files/FilesFeature.jsx`
  row upload/attach actions; `src/app/WorkspaceApp.jsx` `filesPort`;
  `src/app/hooks/useAttachmentTransactions.js` `previewArtifact` and bounded
  type resolution; `src/ui/features/files/ArtifactPreviewPanel.jsx` typed
  unsupported rendering and download action.

## Disposition

**PASS/current.** The old file was removed by the subtractive rewrite, so this
worktree adds one strict successor case rather than restoring the deleted
multi-case file or its obsolete Composer picker path. The successor keeps the
same user action and observable result and uses only public DOM roles/classes;
it does not export or call a private production helper.

Test: `tests/browser/tc0161-unsupported-preview.spec.js:19`.

## Evidence

Base/worktree/branch:

- Base: `b43e356da432c4e0bfc4106bb0331374e5248df4`.
- Worktree: `.worktrees/im-tc0161-f2-0161-b43e356`.
- Branch: `unit-i-m/tc0161-f2-unsupported-preview-b43e356`.

Focused runs on the candidate worktree:

- `ATOLL_TEST_WEB_PORT=15187 ATOLL_TEST_MOCK_PORT=18887 npx playwright test tests/browser/tc0161-unsupported-preview.spec.js --repeat-each=3`
  → **3 passed**.
- `npx vitest run tests/file-browser.test.jsx tests/artifact-preview-resolve.test.jsx tests/right-panel-file-reference.test.jsx --retry=1`
  → **35 passed, 1 expected fail**. The existing expected failure is
  `file-browser.test.jsx`'s configured-storage-device call-count assertion
  (`tests/file-browser.test.jsx:130`); it is unrelated to TC-0161 and was not
  changed.
- `npm run build` → **passed** (Vite production build; only existing chunk-size
  warnings).

No product source, vendor/package/lockfile, notification/arrival owner, second
route/store, compatibility path, skip, or weakened assertion changed for this
case.
