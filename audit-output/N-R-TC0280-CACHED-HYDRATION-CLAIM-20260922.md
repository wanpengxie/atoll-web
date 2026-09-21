# N–R — TC-0280 cached notification hydration claim

Date: 2026-09-22
Claim base: `65452ed6fdea7af948c9fa40698980f844ea8736`

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification baseline:

- numeric key: **TC-0280**;
- baseline declaration: `tests/browser/notification-high-water.spec.js:133`;
- user capability: cached hydration must not resurrect a notification after
  the user has acknowledged the channel tail;
- current owner: `ChannelFeedRuntime` / Replica durable notification boundary,
  with the public channel rail and Reading presentation as consumers.

Exact-key, source-location, title, branch, and worktree searches found no
dedicated TC-0280 claim or successor. TC-0279 is separately claimed/closed;
TC-0280 is the distinct cold-hydration/reload contract. This claim is also
distinct from the occupied SZ198 Feed generation/owner-fence work.

## Preserved public contract

The successor must preserve this user path:

1. Reset the multi-channel fixture and sign in as `root`.
2. Inject two approval roots into `c0.project` and observe two related unread
   messages.
3. Cross the durable cache boundary, reload, and confirm both unread messages
   remain visible in the rail.
4. Open the project channel, switch to the all scope, and physically present
   the hydrated tail so the related badge clears.
5. Reload again and prove the acknowledged tail stays clear; hydration must not
   resurrect it.

Pass evidence must be public DOM plus the existing request/control boundary.
IndexedDB, diagnostics, private cursor fields, and raw row snapshots may only
be attached as diagnostics and cannot be the product oracle. No second
cursor/store, compatibility path, or new owner is permitted.

## Scope and status

The case was migrated to a public-DOM contract in
`tests/browser/notification-high-water.spec.js`. It now proves the two
unread related notifications survive the first reload, clear only after the
hydrated tail is physically presented in the all scope, and stay clear after
the second reload. Diagnostics, raw rail snapshots, and IndexedDB are not a
product oracle for this case.

Verification on this worktree:

- TC-0280 Chromium repeat 3: **3/3 passed** (`27.4s`).
- Adjacent TC-0281 and TC-0282 Chromium: **2/2 passed** (`11.1s`).
- Focused notification units (`notification-fallback`,
  `notification-state-contract`, `nr02-canonical-frontier`, and
  `sz187-notification-following-boundary`): **30/30 passed**.
- Vite production build: **passed** (normal large-chunk warnings only).

No product source, vendor/package file, fixture, second cursor/store, or
compatibility path was changed. The only implementation change is the
existing browser spec's public-DOM assertions; this is the final closeout.
