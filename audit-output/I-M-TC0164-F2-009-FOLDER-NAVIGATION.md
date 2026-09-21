# I–M / TC-0164 (F2-009) exact-path migration

## Scope and ownership

| Item | Contract |
|---|---|
| Baseline | `fae8b70:tests/browser/f2-artifacts.spec.js:200`, ledger `TC-0164` |
| User capability | In the channel Files surface, a directory row is navigated as a directory, not opened as an artifact preview; nested directory creation/deletion and return-to-parent remain usable. |
| Architectural invariant | The public `FilesFeature` surface delegates directory/list/create/delete/navigation to the single `useAttachmentTransactions` owner. A row with `meta.node_type=directory` must not enter the artifact-preview path or create a second directory/preview store. |
| Current public owner | `FilesFeature` through the Workspace Files route and `useAttachmentTransactions`; the test observes only public roles, path state, preview dialog absence, and rendered rows. |
| Allowed files | `tests/browser/tc0164-f2-folder-navigation.spec.js` and this audit only. No product, vendor, package, lockfile, compatibility, or private API changes. |
| Deduplication | TC-0161 covers unsupported file preview; TC-0162 covers local-vs-channel attachment sources; TC-0163 covers paste/drop. F2-FS cases cover split-pane/channel memory. The existing unit `file-browser` directory case checks one public node-type navigation, but does not execute this baseline's nested create/delete/back user journey. |

## Preserved baseline sequence

The strict browser contract keeps the original public journey: open Files,
create `研究资料`, verify it is a directory without an `打开` preview action,
enter it without a preview dialog, create/delete nested `设计`, return to the
parent, and delete the parent. It does not assert old CSS classes or internal
resource calls.

## Evidence

Run from independent worktree `.worktrees/im-tc0164-f2-folder-navigation-993b4cf`
at base `993b4cf` (current HEAD at claim time):

```text
ATOLL_TEST_WEB_PORT=16564 ATOLL_TEST_MOCK_PORT=20564 \
npx playwright test tests/browser/tc0164-f2-folder-navigation.spec.js --repeat-each=3
```

Result: **3/3 passed**. The three repeats all completed the full public
create/enter/no-preview/nested-delete/back/parent-delete sequence. No dialog,
row, or path assertion was weakened.

Focused public-owner evidence:

```text
npx vitest run tests/file-browser.test.jsx --retry=2
→ 1 file, 15/15 passed

npm run build
→ vite build passed
```

A red public result would be a product regression packet, not a reason to
weaken/remove this contract.
