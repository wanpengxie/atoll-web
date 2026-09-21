# N–R — TC-0283 lifecycle notification high-water claim

Date: 2026-09-22
Claim base: `3f6057c75a6fb0f7b1175dcb22b9260b1e4c7ac0`

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification baseline:

- numeric key: **TC-0283**;
- baseline declaration: `tests/browser/notification-policy.spec.js:55`;
- user capability: user-facing lifecycle roots notify exactly once, while
  transport/activity progress stays quiet and an unacknowledged terminal root
  survives reload until its exact rendered row is presented;
- current owner: `ChannelFeedRuntime` / Replica durable notification boundary,
  with the public channel rail and Reading presentation as consumers.

Exact-key, source-location, title, branch, worktree, and audit-file searches
found no dedicated TC-0283 claim or successor. TC-0279 through TC-0282 are
separately claimed/closed; TC-0284 is a distinct readable-root-kind contract.

## Preserved public contract

The successor must preserve this user path:

1. Reset the multi-channel fixture and sign in as `root`; the project rail is
   initially quiet.
2. Emit tail/UI/request/queued/processing/progress lifecycle facts; these are
   ledger activity and must not create a person-facing unread badge.
3. Emit a terminal user-facing root; the project rail exposes one related
   unread badge and keeps it across the durable reload boundary.
4. Re-enter the project, select the all scope, and physically present that
   exact terminal row; the badge clears and does not resurrect.

Pass evidence must be public DOM plus the existing request/control boundary.
Diagnostics, IndexedDB, localStorage, private cursor fields, raw row
snapshots, and geometry probes may only be attached as diagnostics and cannot
be the product oracle. No second cursor/store, compatibility path, or new
owner is permitted.

## Scope and status

The case was migrated to a public-DOM contract in
`tests/browser/notification-policy.spec.js`. It now proves that lifecycle
tail/UI/request/queued/processing/progress facts remain quiet, the readable
terminal root remains unread across reload, and the exact terminal row clears
the canonical badges only after it is physically presented; a second reload
does not resurrect it. Diagnostics, raw rail snapshots, geometry probes, and
IndexedDB are not a product oracle for this case.

Verification on this worktree:

- TC-0283 Chromium repeat 3: **3/3 passed** (`33.5s`).
- Adjacent TC-0284 Chromium repeat 3: **3/3 passed** (`31.2s`).
- Focused notification units (`notification-fallback`,
  `notification-state-contract`, `nr02-canonical-frontier`, and
  `sz187-notification-following-boundary`): **30/30 passed**.
- Vite production build: **passed** (normal large-chunk warnings only).

No product source, vendor/package file, fixture, second cursor/store, or
compatibility path was changed. The only implementation change is the
existing browser spec's public-DOM assertions; this is the final closeout.
