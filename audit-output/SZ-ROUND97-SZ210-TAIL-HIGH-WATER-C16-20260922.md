# SZ-210 — current-main tail receipt installed high-water

## Contract

When Reading reports a settled tail with installed high-water `H`, the
receipt may acknowledge only arrival evidence at sequence `<= H`. A durable
unseen record or Replica arrival at sequence `> H` was not in the installed
sample and must remain user-visible/unacknowledged. A later settled receipt
with the higher fence may consume it.

## Ownership and evidence

The public owner is the existing Reading path on base `c16c2e6`:

`useConversationProjection` creates the settled tail receipt;
`useTimelineArrivalReceipt` forwards its revision and high-water to the
Replica receipt port and durable view-session bridge; `channel-replica` owns
the live arrival journal; `createViewSessionStore` owns durable
`unseenRecords`.

This current-main migration keeps the SZ-204 activationID baseline and its
existing `useTimelineArrivalReceipt(state, controller.activationID)` hook
owner intact. It only adds the typed `throughSeq` boundary to the existing
receipt path.

The public test in
`tests/sz210-tail-high-water-public-owner.test.jsx` seeds durable records
`root-a@3` and `later@5`, reports a settled visible tail at installed fence
`4`, and observes through `readView` plus the public viewport notice:

* `root-a@3` is consumed;
* `later@5` remains in durable `unseenRecords`;
* re-entering browsing exposes exactly one remaining notice.

`tests/live-timeline-arrivals.test.js` additionally drives the public
`arrivalReceipts` port with `installed@3` and `later@5`: a receipt at revision
2/fence 3 removes only the installed event, leaves `later@5`, and a later
fence 5 receipt removes it.

## Non-duplication and result

This is distinct from SZ-204's activation baseline, SZ-205's 1100 live
identity overflow/de-duplication, SZ-208's complete installed-tail durable
backlog, and SZ-209's pre-tail jump boundary. SZ-210 proves the boundary case
where the installed tail is only a prefix of the durable/live arrival stream.

The prior public-owner execution failed because the tail acknowledgement
cleared all durable records and the live receipt cleared by revision alone.
The current owner now carries the typed installed sequence fence; no second
store, cursor, compatibility path, activation owner, or private state oracle
was added.

## Verification

The current-base focused matrix is run before commit:

`sz204-live-activation-unseen-public-owner.test.jsx`,
`sz205-live-overflow-public-owner.test.jsx`,
`sz208-installed-tail-backlog-public-owner.test.jsx`,
`sz209-jump-latest-pre-tail-public-owner.test.jsx`,
`sz210-tail-high-water-public-owner.test.jsx`, and
`live-timeline-arrivals.test.js`.
