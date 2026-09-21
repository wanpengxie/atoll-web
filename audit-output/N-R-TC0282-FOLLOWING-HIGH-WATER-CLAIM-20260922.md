# N–R — TC-0282 following-tail notification high-water claim

Date: 2026-09-22
Claim base: `871ca7e9f6a2bc4b42e97f528b1c0ed9d1eb9af2`

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification baseline:

- numeric key: **TC-0282**;
- baseline declaration: `tests/browser/notification-high-water.spec.js:243`;
- user capability: while following a mounted channel tail, a newly related
  arrival is acknowledged only after that arrival is physically presented;
- current owner: `ChannelFeedRuntime` / Replica durable notification boundary,
  with the public channel rail and Reading presentation as consumers.

Exact-key, source-location, title, branch, worktree, and audit-file searches
found no dedicated TC-0282 claim or successor. TC-0279, TC-0280, and TC-0281
are separately claimed/closed; this is the distinct continuously-followed
live-arrival contract. The claim is also distinct from occupied Feed
generation/owner-fence work.

## Preserved public contract

The successor must preserve this user path:

1. Reset the multi-channel fixture and sign in as `root`.
2. Open `c0.project`, switch to the all scope, and establish a zero unread
   related badge at the mounted tail.
3. Inject one related approval while the channel remains actively followed.
4. Verify the new approval is a public, mounted timeline row and the channel
   rail remains acknowledged; the live arrival may advance the durable
   boundary only for that physically presented row.
5. Preserve the all-scope rail's canonical `{related, other, pending, unknown}`
   behavior and the existing authority/high-water fence.

Pass evidence must be public DOM plus the existing request/control boundary.
Diagnostics, private cursor fields, raw row snapshots, and IndexedDB may only
be attached as diagnostics and cannot be the product oracle. No second
cursor/store, compatibility path, or new owner is permitted.

## Scope and status

The case was migrated to a public-DOM contract in
`tests/browser/notification-high-water.spec.js`. It now proves that a live
related approval has a visible, mounted row in the actively followed tail
while the canonical related/other badges remain clear; the receipt is not
derived from diagnostics or a private high-water snapshot.

Verification on this worktree:

- TC-0282 Chromium repeat 3: **3/3 passed** (`17.3s`).
- Adjacent TC-0280 and TC-0281 Chromium repeat 3: **6/6 passed** (`48.2s`).
- Focused notification units (`notification-fallback`,
  `notification-state-contract`, `nr02-canonical-frontier`, and
  `sz187-notification-following-boundary`): **30/30 passed**.
- Vite production build: **passed** (normal large-chunk warnings only).

No product source, vendor/package file, fixture, second cursor/store, or
compatibility path was changed. The only implementation change is the
existing browser spec's public-DOM assertions; this is the final closeout.
