# SZ-208 — installed-tail clears the durable scope backlog

Date: 2026-09-22

## Claim and owner

- Baseline: `SZ-208` / historical `TC-1379`, whose user capability is that
  reaching the installed tail acknowledges every already-installed unseen
  identity in the current scope, not only the row that was hit-tested at the
  tail.
- Current public owner: `createViewSessionStore` owns the durable
  `unseenRecords` fact; `useConversationProjection` owns the Reading viewport
  and its `tailCaughtUp` receipt; `useTimelineArrivalReceipt` is the single
  acknowledgement bridge.
- Base: `2f90f9ed1c02ae00e20fb7fa5e6206a916b6a381`.

## Contract

The test first uses the public `createViewSessionStore` API to persist two
unseen records (`arrival-a@3`, `arrival-b@4`) through an activated browsing
view, then deactivates it and creates a fresh store over the same storage.
Those two rows are already installed as history before the Reading owner
mounts; there are no post-mount live commits in this case.

The public viewport must restore an unseen count of `2`. A settled tail
observation hit-tests only `arrival-b`, while carrying the installed boundary
`4`. The acknowledgement must clear both durable records. Re-entering browsing
after the receipt must therefore expose zero unseen rows, and the public store
must still report `unseenRecords: []`.

This is intentionally distinct from SZ-205: it does not create or overflow a
live-arrival batch, and it does not inspect arrival-receipt internals.

## Evidence

Test: `tests/sz208-installed-tail-backlog-public-owner.test.jsx`

- `createViewSessionStore` `activate → save → deactivate` seeds the durable
  backlog, and a fresh store's public `readView` restores both records.
- The mounted projection sees the already-installed history and reports
  `viewport.unseenNotice === 2`; the Presentation tail is `arrival-b`.
- The settled public Reading observation contains only
  `visibleRowIDs: ['arrival-b']`, yet `tailCaughtUp` reports `boundary=4` and
  `physicalSeq=4`.
- After the receipt, public `readView(...).unseenRecords` is empty and a new
  browsing gesture reports `unseenNotice === 0`. If acknowledgement were
  limited to the visible row, `arrival-a` would remain durable and reappear.

Focused Vitest: PASS (1 test). Product/source files, vendor, package/lockfile,
compatibility paths, and skips are unchanged; no private export or second
owner was added.
