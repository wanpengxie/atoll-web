# I-M / TC-0162 — Composer attachment-source distinction

## Verdict

**ACCEPT.** The exact historical public contract is restored as one independent
browser case. It passes three clean Chromium repeats on exact base
`ffe7d0f1a9fdbe6f48c60f667aa033ed2beb434f`.

This change is test/audit only. No production, package, lockfile, or
compatibility layer was changed.

## Baseline and ownership

| Item | Evidence |
| --- | --- |
| Historical case | `fae8b70:tests/browser/f2-artifacts.spec.js:105`, ledger `TC-0162` |
| User capability | Composer exposes two distinct public attachment sources: native local-file upload and daemon channel-file selection. Both can produce a draft attachment without replacing the conversation surface. |
| Composer owner | `src/ui/composer/Composer.jsx`: public file input, channel-file button, draft preview/remove, responsive toolbar and drop/paste boundary. |
| Wiring owner | `src/app/WorkspaceApp.jsx:754-880`: the attachment port supplies `upload`, `pickChannelFile`, and public preview/attachment operations; `src/app/hooks/useAttachmentTransactions.js` owns the resource transaction. |
| Allowed files | `tests/browser/tc0162-composer-source-distinction.spec.js`, this audit report only. |
| Deduplication | TC-0160 remains the previously rejected full Files/preview path; TC-0161 is already accepted; TC-0163 is separately claimed. This case covers the distinct Composer source contract and is not a replacement for any of those cases. |

## Preserved user sequence and invariants

The test keeps the old setup/action/result sequence rather than reducing it to
a single attachment-count assertion:

1. The local upload input and daemon picker are both visible public controls.
2. A native `直接上传.txt` selection appears in `待发送附件`; its public draft
   preview shows the uploaded content, then public remove clears that draft.
3. Opening the public daemon picker and selecting the same resource closes the
   picker and recreates exactly the channel-file attachment. The canonical
   `动态` tab remains selected.
4. At 360px, both source controls are at least 44×44px, focus can move from
   local upload to daemon picker with one Tab, and the Composer surface has no
   horizontal overflow. The reading-slot vertical bounds are unchanged by
   focusing the toolbar.
5. The mobile public `频道操作 → 打开文件` path still exposes a 44×44px Files
   upload control; the test does not inspect a private owner or store.

## Executed evidence

From worktree `.worktrees/im-tc0162-f2-source-distinction-ffe7d0f` on branch
`unit-i-m/tc0162-f2-source-distinction-ffe7d0f`:

```text
ATOLL_TEST_WEB_PORT=16173 ATOLL_TEST_MOCK_PORT=19832 \
  npx playwright test tests/browser/tc0162-composer-source-distinction.spec.js \
  --repeat-each=3
3 passed (1.0m)

npx vitest run \
  tests/f6-composer-isolation.test.jsx \
  tests/app-shell-composer-port.test.jsx \
  tests/outbox-attachment-transaction.test.js \
  tests/workspace-file-picker.test.jsx
4 files passed, 25 tests passed

ATOLL_TEST_WEB_PORT=28173 ATOLL_TEST_MOCK_PORT=29832 \
  npx playwright test tests/browser/composer-channel-file-picker-contract.spec.js \
  --repeat-each=2
10 passed (59.2s)

npm run build
✓ built in 5.63s
```

The build emitted only the existing large-chunk advisory; it completed
successfully. The Vitest run printed the existing jsdom canvas `getContext`
notice but all selected owner tests passed.
