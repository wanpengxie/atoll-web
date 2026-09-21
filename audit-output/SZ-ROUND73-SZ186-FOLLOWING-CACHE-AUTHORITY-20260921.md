# SZ-186 fresh-following cache authority — 2026-09-21

## User capability and invariant

Fresh following may show a readable cached Projection immediately. That cached
view is not, by itself, permission to follow the channel tail: until the
current Replica revision is consumed, the public following authority remains
stale. Once the Presentation source revision catches the history authority,
the same visible row may become current without issuing a history request.

The invariant is intentionally distinct from SZ-185: SZ-185 covers a detached
cache failure and its typed retry; SZ-186 covers a readable cache whose source
revision lags the current history presentation revision.

## Unique public owner

The test uses the current `useConversationProjection` public viewport. Its
`projection.presentation` is the cached user-visible surface and
`viewport.bottomReady`/`viewport.tailCaughtUp` are the public tail-authority
facts. `useHistoryConsumer` remains the sole request owner; no private cache
field, retired `useReadingSession`, second store, or compatibility path is
used.

## Evidence and result

`tests/sz186-following-cache-authority.test.jsx` starts with an empty detached
following view, then publishes a cached `head-row` at source revision 10 while
history requires presentation revision 11. It proves the row appears and is
readable immediately, but `bottomReady` and `tailCaughtUp.caughtUp` remain
false and no request is manufactured. Publishing the Replica revision 11 then
makes `bottomReady` true with the same row and still no request.

Current-main base:
`4d6a09c884f0d56b37ad677585f51f753f41c1d2`.

Focused command:

```text
npm test -- --run tests/sz186-following-cache-authority.test.jsx
```

Result: 1 file passed, 1 test passed. Product files were not changed; no
skip/deletion, compatibility layer, vendor/package/lockfile, or private oracle
was introduced.

Decision: **ACCEPT / close SZ-186 evidence**.
