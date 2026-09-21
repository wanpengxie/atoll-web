# N–R — TC-0279 notification high-water claim

Date: 2026-09-22
Claim base: `c749458b3c887aa4944a562ea81f01369c83276d`

## Atomic claim and de-duplication

This worktree claims exactly one Notification/Feed baseline:

- numeric key: **TC-0279**;
- baseline declaration: `tests/browser/notification-high-water.spec.js:64`;
- user capability: tail acknowledgement survives channel switches and reload,
  while a later related row remains unread until the user presents it;
- current owner: `ChannelFeedRuntime` / `notification-policy` durable
  high-water and the existing public rail/Reading receipt boundary.

Exact-key/source/title searches across the current commit graph found no
dedicated TC-0279 claim or successor. The claim is distinct from the already
occupied SZ198 Feed generation/owner-fence case and from NR02's prior canonical
projection work: this packet audits the concrete high-water persistence,
channel-switch, reload, and future-arrival user journey at the current public
browser entry.

## Preserved public contract

The successor must keep the baseline's complete user path:

1. Reset the multi-channel fixture and sign in as `root`.
2. Inject two approval roots into `c0.project`; observe the related unread
   count.
3. Open the project channel, switch from related to all, and acknowledge only
   the physically presented tail.
4. Switch away and back, reload, and prove the acknowledged boundary remains
   durable.
5. Inject one later approval; it must notify below the acknowledged boundary.
6. Present that later row and prove the exact high-water advances once.

Evidence must use public DOM plus the existing request/control boundary and
canonical rail snapshot. It must not use private cursor state, IDB rows as a
product oracle, a second store/cursor, or diagnostic-only success.

## Closeout

The retained TC-0279 browser case was migrated to the public contract in
`tests/browser/notification-high-water.spec.js`. Its assertions now use only
the visible related/other rail badges and the public channel heading/scope:
two approvals are acknowledged, the zero state survives leave/reselect and
reload, a later approval produces one unread badge, and presenting that later
tail clears it. The previous diagnostic rail/high-water snapshot is not used
as a product pass oracle by this case; adjacent cases retain their narrower
diagnostic evidence for their separate contracts.

Verification from this worktree:

- TC-0279 public case: **3/3 Chromium repeat pass**;
- adjacent high-water cases TC-0280/0281/0282: **3/3 pass**;
- focused notification unit suites (`notification-fallback`,
  `notification-state-contract`, `nr02-canonical-frontier`,
  `sz187-notification-following-boundary`): **30/30 pass**;
- production Vite build: **pass**.

No product source, vendor/package file, mock fixture, second cursor/store, or
compatibility path was changed. The final commit contains only this closeout
and the public assertion migration.
