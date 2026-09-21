# SZ-180 current source reacquisition — 2026-09-21

## User capability and invariant

When an empty local Reading window has an active history-supply obligation,
the user should receive one anticipatory reacquisition after the old source
settles. Replacing the source authority A→B→C while that successor is still
pending must not create a duplicate request, lose the current C authority, or
reuse the retired source's completion as current data.

The observable invariant is: source A settles once; the current public
history consumer issues exactly one successor operation for the committed C
source after the B→C replacement; that C operation settles successfully once,
with no reuse of A and no duplicate operation. Every authority fact other
than `sourceLease` is fixed: generation 1, attached true, messageCurrent true,
local readiness, coverage, sync, and presentation revisions. The public
viewport status ends at generation 1, `sourceLease: 'source-C'`, with
`hasOlder: true`.

## Unique public owner

The test uses the current `useConversationProjection` public port. Its
`useHistoryConsumer` is the sole history-demand owner and receives the
read-only `history.status` source/generation facts. The test does not use the
retired `useReadingSession`, internal scheduler state, a second store, private
exports, or request-count-only fixture aliases.

## Evidence and result

`tests/sz180-history-source-reacquisition.test.jsx` starts from a public empty
projection with source A, observes the real `projection-underfill` demand,
settles A as cancelled, then publishes source B and source C in one committed
public-owner update. It verifies:

- the initial request is the current public `projection-underfill` obligation;
- source B creates no transient request and the committed C source creates
  exactly one distinct successor request;
- the committed viewport reports source C/generation 1 and still has older
  supply;
- the C successor resolves as `{ kind: 'loaded' }`, while A remains exactly
  once and no duplicate C request appears.

Current-main base:
`3675ae2fa5479e56a16b2b32e731a64f476d206d`.

Focused command:

```text
npm test -- --run tests/sz180-history-source-reacquisition.test.jsx
```

Result: 1 file passed, 1 test passed. The focused fixture was repeated five
times and the production build passed. Product files were not changed; no
skip/deletion, compatibility layer, vendor/package/lockfile, or private oracle
was introduced.

Decision: **ACCEPT / close SZ-180 evidence**.
