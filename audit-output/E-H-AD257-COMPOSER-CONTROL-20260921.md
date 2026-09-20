# E–H — AD257 Composer control recovery

Date: 2026-09-21
Base: `1cbd754f78be33b89c929944175055bbf04beacd`

## Case record

| Field | Evidence |
|---|---|
| Unique baseline case | `fae8b70:tests/control-actions.test.js:27-41`, “只保存可解释的活动状态并把 Error 转成可序列化错误”; the migrated public evidence is `[AD-257]` in `tests/blocked-round24-public-owner.test.jsx`. |
| User capability | After a failed control action and refresh, the user can still understand the failure from bounded code/detail data; terminal/unrelated control states do not reappear as active controls. |
| Invariant | The durable boundary stores only active control facts and a plain `{ code, detail }` error record. A raw `Error`, stack, transport object, or terminal state is never restored into the active control projection. |
| Current public owner | `useComposerSubmissionRuntime` in `src/ui/composer/useComposerSubmissionRuntime.js`, through its public `cancel()` result and `controlStates` projection; its existing outbox factory is the sole persistence seam. |
| Baseline setup/action/observable | Seed a public cancel with `Error('连接关闭')` plus `code: 'closed'`, invoke `cancel('c0', 'request-2')`, unmount/remount the same owner, and observe the recovered `uncertain` state with `{ code: 'closed', detail: '连接关闭' }`. Also seed a terminal `resolved` control row and verify it is absent after hydration. |
| Current result | **PASS**: the current owner serializes the failure before `putMany`, restores it as the same bounded record, and filters `resolved` rows. |
| Disposition | **MIGRATE/CLOSE** in the existing public-owner test. No second store, owner, compatibility path, private export, or fixture-specific branch is needed. |

## Strict evidence added

The public test now checks both sides of the refresh boundary:

- the failed persisted control row is `kind: control`, `state: uncertain`, and
  exactly `{ code: 'closed', detail: '连接关闭' }`;
- the persisted error is not an `Error` instance and survives
  `JSON.stringify`/`JSON.parse` unchanged;
- remount restores the same explainable error, while a `resolved` row remains
  filtered from `controlStates`.

This preserves the old user action and observable while proving the current
owner's durable representation, rather than trusting only an in-memory hook
value.

## Verification

```text
npm exec vitest run tests/blocked-round24-public-owner.test.jsx -- -t AD-257 --reporter=verbose
1 passed
```

The change is limited to the existing public-owner test and this audit. No
product source, second outbox/store, compatibility API, vendor/package/
lockfile, backend, protocol, skip, or weakened assertion was added.
