# SZ-180 current source reacquisition — 2026-09-21

## User capability and invariant

When an empty local Reading window has an active history-supply obligation,
the user should receive one anticipatory reacquisition after the old source
settles. Replacing the source authority A→B→C while that successor is still
pending must not create a duplicate request, lose the current C authority, or
reuse the retired source's completion as current data.

The observable invariant is: source A settles once; the current public
history consumer issues exactly one successor operation; after source B and
then source C replace the authority, no third operation is issued while that
successor remains pending. The public viewport status ends at generation 2,
`sourceLease: 'source-C'`, with `hasOlder: true`.

## Unique public owner

The test uses the current `useConversationProjection` public port. Its
`useHistoryConsumer` is the sole history-demand owner and receives the
read-only `history.status` source/generation facts. The test does not use the
retired `useReadingSession`, internal scheduler state, a second store, private
exports, or request-count-only fixture aliases.

## Evidence and result

`tests/sz180-history-source-reacquisition.test.jsx` starts from a public empty
projection with source A, observes the real `projection-underfill` demand,
settles A as cancelled, then publishes source B and source C. It verifies:

- the initial request is the current public `projection-underfill` obligation;
- one and only one successor request is made after the A settlement;
- the committed viewport reports source C/generation 2 and still has older
  supply;
- no duplicate request appears across the B→C replacement while the
  successor remains pending.

Current-main base:
`3675ae2fa5479e56a16b2b32e731a64f476d206d`.

Focused command:

```text
npm test -- --run tests/sz180-history-source-reacquisition.test.jsx
```

Result: 1 file passed, 1 test passed. Product files were not changed; no
skip/deletion, compatibility layer, vendor/package/lockfile, or private oracle
was introduced.

Decision: **ACCEPT / close SZ-180 evidence**.
