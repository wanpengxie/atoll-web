# TC-1199 / SZ-031 — unknown access is not durably queued

## Claim and provenance

- Numeric claim: `TC-1199`, alias `SZ-031` from `SZ-NUMERIC-UNIT-MIGRATION.md`.
- Legacy user contract: `fae8b70:tests/submission-outbox.test.jsx:139`, “does not durably queue unknown access, then accepts after membership is confirmed”. The old path first exposes an unknown relationship, attempts the same message, requires the access error, asserts no transport/no pending durable row, then changes the relationship to `member` and sends the same stable message identity successfully.
- The numeric migration ledger calls SZ-031 green, but no standalone TC-1199/SZ-031 closure packet or branch was present at base `2f90f9ed1c02ae00e20fb7fa5e6206a916b6a381`. This report records the current public-owner evidence without reopening the already-distinct TC-1201 membership-revocation contract.

## Current owner and invariant

The sole owner is `useComposerSubmissionRuntime` and its `createOutboxStore` boundary. `captureRequestOwner`/`assessRequestOwner` provide the current access fact; `send` authorizes the persist phase before creating a durable submission. Therefore an `unknown` relationship fails closed before `putMany`, `pending` remains empty, and the transport `submit` function is not called. After the access projection changes to `member`, the same `messageId` is accepted through the normal Composer submission path.

This is distinct from TC-1201/SZ-032/033-style revocation: no queued intent exists yet in this contract, so revocation and stale queued-row settlement are out of scope. No roster or legacy submission store is an identity owner.

Relevant current implementation points are `src/ui/composer/useComposerSubmissionRuntime.js:326-367` and `:827-922`; the public successor assertion is `tests/submission-outbox-current.test.jsx:324-344`.

## Public evidence

The current successor renders the production hook with a real `createOutboxStore` harness, sets access to `relationship: 'unknown'`, and sends `messageId: 'm4'`. The send rejects, `pending` stays empty, and `submit` is not called. It then changes the access projection to `member`, rerenders through `accessVersion`, sends the same `m4`, and observes one accepted transport call. The focused test does not inspect private helpers or restore a legacy store.

Executed from the independent worktree:

```text
base:     2f90f9ed1c02ae00e20fb7fa5e6206a916b6a381
branch:   codex/composer-tc1199-unknown-access-2f90f9e
worktree: .tmp-tc1199-unknown-access-2f90f9e

focused command (5 repeats):
npx vitest run tests/submission-outbox-current.test.jsx \
  -t 'refuses durable acceptance without confirmed membership and accepts after access changes' \
  --reporter=dot
→ 1 passed, 15 skipped on each of 5/5 repeats

adjacent command:
npx vitest run tests/submission-outbox-current.test.jsx \
  tests/submission-outbox.test.jsx \
  tests/submission-outbox-sendlease-contract.test.jsx --reporter=dot
→ 3 files, 32 tests passed

public Chromium adjacency:
npx playwright test tests/browser/offline-composer-recovery.spec.js --reporter=line
→ 1 passed (9.6s); offline Composer draft/recipient state survives reload and
  submits exactly once after reconnect. This is adjacent durability evidence,
  not a private oracle for unknown-access admission.

npm run build
→ exit 0 (only existing chunk-size warnings)
```

## Scope decision

No product change is required: the current public owner already enforces the fail-closed unknown-access admission and later membership transition. This commit adds only this audit/closure evidence. No Composer source, Workspace/Feed/Roster code, test, vendor, package, backend, protocol, store, compatibility layer, or second owner was changed.
