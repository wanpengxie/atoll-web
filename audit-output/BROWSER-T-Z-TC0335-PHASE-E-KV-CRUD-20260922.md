# Browser T-Z — TC0335 / E-BR-07 KV resource CRUD

## Reservation and scope

- Baseline: `fae8b70`, `tests/browser/phase-e.spec.js:187-205` (`E-BR-07 KV create/read/write/stat/list/delete 完整闭环`).
- Exact test base: `357de99c273e1e9da1cd87e95eb20465b627e7a2`.
- Successor: `tests/browser/tc0335-phase-e-kv-crud.spec.js`.
- This worktree is detached at the exact base; only the successor spec and this audit are in the candidate commit.
- No product source, vendor, package, fixture, mock, screenshot, threshold, skip, or assertion weakening is included.

## User contract mapping

The migration follows the old user path through the existing `频道操作 → 高级资源工具 → KV` surface and keeps the old seed (`resource-workflow`, 305). It asserts visible result receipts for the complete lifecycle:

1. `列出` starts empty.
2. `创建` with `kv:browser` and `{"value":1}` returns the resource id and value.
3. `写入` with `{"value":2}` visibly returns the new value.
4. `读取` visibly returns the same resource id and value.
5. `状态` visibly reports `"exists": true`.
6. A second `列出` visibly includes the KV row and kind.
7. `删除` visibly reports `"deleted": true`.
8. A final `状态` visibly reports `"exists": false`.

The assertions are against the public result panel, not private state or implementation internals. The extra post-delete state check makes the delete result user-observable and guards against a stale result panel.

## Uniqueness review

The existing `TC-0263` browser successor only opens the resource panel and performs one demo create; it does not cover E-BR-07's full CRUD/list lifecycle. Existing phase-E rows for E-BR-0331–0339 remain either absent, assigned to other owner worktrees, or are separate template/device/file/timer/permission contracts. No tracked spec or audit for `TC0335`/`E-BR-07` was found at reservation time. TC0336 file workflow and the active TC0337–TC0339 candidates were not claimed or modified.

## Verification

All commands ran from this detached worktree. The worktree used a symlink to the
already-installed dependency tree only; no dependency or package file changed.

- Chromium repeat3 (fresh Playwright run, ports 25473/25483):
  `ATOLL_TEST_WEB_PORT=25473 ATOLL_TEST_MOCK_PORT=25483 playwright test tests/browser/tc0335-phase-e-kv-crud.spec.js --repeat-each=3`
  — **3 passed (15.7s)**.
- Adjacent resource/channel action regression (desktop + mobile,
  `tests/browser/tc0263-channel-actions.spec.js`, ports 25474/25484):
  — **2 passed (14.0s)**.
- Production build: `npm run build` — **passed**, 4306 modules transformed;
  only the existing chunk-size advisory was emitted.

## Verdict

**ACCEPT** for the migrated browser contract. The public KV panel completed
empty-list → create → write → read → stat-present → list-present → delete →
stat-absent on all three fresh browser runs. No product gap was observed and no
product source was changed.
