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

## Verification and closeout

The smallest public-owner successor was added to
`tests/notification-state-contract.test.js`: it admits a `ui.state` request
and `system.member.created` narration into the same Feed, asserts the public
`unreadFor` projection remains `{ related: 0, other: 0, pending: false,
unknown: false }`, then admits a normal related request and asserts that the
rail becomes `{ related: 1, other: 0, pending: false, unknown: false }`.
This proves the current owner does not silence ordinary conversation with a
broad type filter.

Evidence on the claimed worktree:

- Focused successor: **1/1 passed** (`[TC-0587]`).
- Notification/Feed owner set (`notification-state-contract`,
  `notification-fallback`, `nr02-canonical-frontier`,
  `channel-feed-runtime`, `n-r-public-owner-contracts`,
  `sz187-notification-following-boundary`, and
  `sz214-unfiltered-high-water-public-owner`): **7 files / 68 tests passed**.
- Existing public notification browser contract
  (`tests/browser/notification-policy.spec.js`, Chromium, repeat 3):
  **6/6 passed**.
- `npm run build`: **passed** (only the existing large-chunk advisory).

Only the successor test and this audit report changed. No product source,
vendor/package file, fixture, second cursor/store, compatibility path, or
private diagnostic assertion changed.

**Disposition: ACCEPT / MIGRATED; credit: 1.**

This reservation report is committed before any successor test change.
