# SZ-187 notification following boundary

## Contract

The retained S-Z baseline is one notification obligation with a frozen
boundary. A tail observation may acknowledge the boundary captured by that
observation, but a later mutable Meta/head advance is not a new observation
and must not replay or extend the receipt. A newly materialized row may advance
the same obligation only after the current Reading owner reports a settled,
visible tail containing that row.

The single owner chain is:

`useConversationProjection.viewport` → `onTailCaughtUp` → existing Feed
`acknowledgeNotifications` port.

No second cursor, notification store, or compatibility owner is introduced.
The test treats only typed `tail-backlog`/`presented-follow` receipts with a
positive frozen boundary as accepted public evidence; incomplete callbacks are
not high-water commits.

## Baseline migration

The original `tests/timeline-reading-integration.test.jsx` was removed during
the S-Z reconciliation. SZ-187 was retained as OPEN in
`audit-output/SZ-NUMERIC-UNIT-MIGRATION.md` and
`audit-output/SZ-ROUND22-OWNER-REVERIFY-20260920.md`. This successor keeps the
original user contract while using the current public projection owner and its
typed Reading observation input.

## Evidence

`tests/sz187-notification-following-boundary.test.jsx` proves:

1. Meta advances from 100 to 101 before a new paint; the first settled
   observation captures exactly boundary 101 even though row 100 is installed.
2. A Meta-only advance to 102 produces no second valid receipt.
3. After row 102 is materialized and observed in the settled visible tail, one
   new valid receipt advances the boundary to 102 and includes row 102 in its
   visible identity set.

The test uses `useConversationProjection` and its public viewport port only;
there is no private Feed/Reading state inspection.
