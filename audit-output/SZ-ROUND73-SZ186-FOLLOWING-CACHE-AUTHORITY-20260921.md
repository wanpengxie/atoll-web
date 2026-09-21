# SZ-186 fresh-following cache authority — 2026-09-22

## User capability and invariant

Fresh following may show cached Projection rows immediately, but visible rows
are not yet a readable surface: until the current activation publishes its
first materialized range receipt, availability remains `materializing`. The
same cached row is still not permission to follow the channel tail. Even after
the current Replica revision is consumed and the range receipt is accepted,
physical `tailCaughtUp` authority remains a separate observation and is not
manufactured by Projection.

The invariant is intentionally distinct from SZ-185 and SZ-200: SZ-185 covers
a detached cache failure and its typed retry; SZ-200 covers an empty cold
entry's first range; SZ-186 covers a following cache with rows already visible
while the current range receipt is still pending, plus the no-tail-authority
boundary.

## Unique public owner

The test uses the current `useConversationProjection` public viewport. Its
`projection.presentation` is the cached user-visible surface and
`viewport.bottomReady`/`viewport.tailCaughtUp` are the public tail-authority
facts. `useHistoryConsumer` remains the sole request owner; no private cache
field, retired `useReadingSession`, second store, or compatibility path is
used.

## Evidence and result

`tests/sz186-following-cache-authority.test.jsx` starts with an empty detached
following view, then publishes a cached `head-row` at Replica source revision
10 while history requires presentation revision 11. Admission has no
`sourceFence` override, so the public Projection source revision is exactly
the Replica `_timelineRevision`: 10 while lagging and 11 after catch-up. It
proves the row appears while availability remains `materializing`,
`presentationPending` remains true, `bottomReady`/`tailCaughtUp.caughtUp` do
not grant physical tail authority, and no request is manufactured. After
Replica revision 11, stale activation/revision/negative-range receipts are
rejected and the viewport remains `materializing`; only the exact current
activation + Presentation revision + non-negative range receipt transitions
to `readable`. The same row remains visible, `tailCaughtUp.caughtUp` remains
false, and history request count stays zero.

Current-main base: `89c04f13e683d092e84f7bd26ae9a5e4aac19336`.

Focused command:

```text
npm test -- --run tests/sz186-following-cache-authority.test.jsx
```

Result: focused SZ-186 + SZ-200 passed (2 files, 2 tests), repeated 5/5.
Adjacent history/Reading checks passed (8 files, 16 tests): SZ-180, SZ-182,
SZ-191, SZ-192, SZ-193, SZ-194, reading observation settle, and bottom-intent
waiting. `npm run build` passed with the existing chunk-size warning. Product
files were not changed; no skip/deletion, compatibility layer,
vendor/package/lockfile, or private oracle was introduced.

Decision: **ACCEPT / close SZ-186 evidence**.
