# N–R — TC-0587 UI/system narration stays out of rail notifications

Date: 2026-09-22

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification/Feed
baseline:

- **Case:** `TC-0587`.
- **Legacy declaration:** `fae8b70:tests/cursors.test.js:515`.
- **Current base:** `546a3d5` (`refactor/frontend-subtractive-cleanup`).
- **Branch/worktree:** `codex/tc0587-notification-546a3d5` /
  `atoll-web-tc0587-notification-546a3d5`.
- **Current owner:** the single `ChannelFeedRuntime`/`ChannelReplica` row
  owner, with `notification-policy` as the shared classifier and `unreadFor`
  as the rail projection. No second cursor, store, diagnostic oracle, or
  compatibility path is in scope.

Exact searches across the tracked tests, audit reports, branches, and
registered worktrees found no TC-0587 reservation, successor, or candidate.
TC-0279–TC-0284, TC-1085, NR02, and SZ187 are separate already-claimed or
closed contracts and are not reused by this claim.

## User contract

Browser UI operation streams and system governance narration can be present in
the Feed/Replica ledger, but must not produce a person-facing related/other
rail badge. They remain available to the existing non-notification projections
when their own owner admits them. A real readable conversation root remains
eligible for the canonical notification projection, so this claim must not
silence ordinary content as a broad type filter.

The current public contract will be driven through `createChannelFeedRuntime`
and its `unreadFor`/notification snapshot; policy-only classification is
supporting evidence, not the product oracle.

## Verification plan

Before closeout, add only the smallest public-owner assertion if the existing
contract does not already cover this exact user boundary. Run the focused
notification/Feed suites and build. If the current owner fails, record the
first public boundary and stop at a bounded regression packet; do not add a
compatibility path or alter product source outside the existing Feed/Replica/
Policy owner.

This reservation report is committed before any successor test change.
