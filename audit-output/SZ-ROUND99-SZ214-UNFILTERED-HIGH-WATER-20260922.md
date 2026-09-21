# S–Z round 99 — SZ-214 unfiltered high-water receipt

## Claim and uniqueness

This work claims only `SZ-214`, the baseline contract that an unfiltered
tail may advance the physical read cursor to the installed high-water even
when that high-water update is above the viewport. It does not claim SZ-210's
bounded durable/live-arrival acknowledgement, SZ-208's complete durable
backlog, or SZ-150's exact-tail zero-before-observation fence.

The numeric ledger has one SZ-214 row from
`tests/timeline-reading-integration.test.jsx`; no current worktree or branch
in the S–Z lane contains an SZ-214 successor. Existing SZ-150 evidence only
uses a two-row exact-tail sample (`physicalSeq === 2`); it does not place a
seq-52 update above a visible seq-40 presentation tail.

## User capability and invariant

When the reader is following an unfiltered channel and the settled DOM
reports a visible presentation tail, the physical read acknowledgement must
carry the installed channel high-water. The viewport need not contain the row
that supplied that high-water: virtualized rows above the viewport are still
installed history and are covered by the physical cursor fence.

The invariant is bounded authority: `physicalSeq` is the settled observation's
installed high-water, never a mutable later head and never a filtered-scope
identity receipt. The public owner is
`useConversationProjection().viewport.tailCaughtUp` and its
`onTailCaughtUp` receipt, consumed by the existing Feed/ConversationSurface
integration.

## Public evidence

`tests/sz214-unfiltered-high-water-public-owner.test.jsx` uses the public
`useConversationProjection` hook and `viewport.onReadingObservation`. It
constructs a stable presentation whose visible tail is `tail@40`, while an
earlier stable row has the installed high-water `old-root@52`. The observation
reports only `tail` in `visibleRowIDs` and `installedHighSeq: 52`; assertions
check the public `tailCaughtUp` tuple and the public `onTailCaughtUp` receipt:

* `caughtUp` is true only after the settled authority observation;
* `boundary` and `physicalSeq` are both exactly `52`;
* the receipt still reports only the visible tail row, proving no private
  row-map or internal cursor oracle is being asserted.

No product source, protocol, store, compatibility path, skip, or old API was
changed.

## Verification

Focused command:

`./node_modules/.bin/vitest run tests/sz214-unfiltered-high-water-public-owner.test.jsx --reporter=dot`

Result: 1 test passed on base `c16c2e6`.
