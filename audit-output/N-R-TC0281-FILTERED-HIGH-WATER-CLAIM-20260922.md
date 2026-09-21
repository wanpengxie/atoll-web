# N–R — TC-0281 filtered notification high-water claim

Date: 2026-09-22
Claim base: `9ab7edd4231fd46f48da7f91000dbd7413f600eb`

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification baseline:

- numeric key: **TC-0281**;
- baseline declaration: `tests/browser/notification-high-water.spec.js:203`;
- user capability: a filtered tail must not acknowledge a channel notification
  boundary until the user leaves the filter and presents the complete tail;
- current owner: `ChannelFeedRuntime` / Replica durable notification boundary,
  with the public channel rail and Reading presentation as consumers.

Exact-key, source-location, title, branch, worktree, and audit-file searches
found no dedicated TC-0281 claim or successor. TC-0279 and TC-0280 are
separately claimed/closed; this is the distinct filtered-tail boundary
contract. The claim is also distinct from the occupied SZ198 Feed
generation/owner-fence work.

## Preserved public contract

The successor must preserve this user path:

1. Reset the multi-channel fixture and sign in as `root`.
2. Open `c0.project`, enable the project-agent filter, and return to `c0`.
3. Inject two approval roots into `c0.project`; the filtered channel rail must
   show two related unread notifications.
4. Re-enter the project while the filter remains active; the filtered tail
   must not acknowledge the hidden/unrepresented sibling boundary.
5. Leave the filter, switch to the all scope, and physically present the full
   tail; only then may the related badge clear and the durable high-water move
   to the contiguous boundary.

Pass evidence must be public DOM plus the existing request/control boundary.
IndexedDB, diagnostics, private cursor fields, and raw row snapshots may only
be attached as diagnostics and cannot be the product oracle. No second
cursor/store, compatibility path, or new owner is permitted.

## Scope and status

The case was migrated to a public-DOM contract in
`tests/browser/notification-high-water.spec.js`. It now proves that the two
approval notifications remain unread while the project-agent filter hides
part of the channel tail, remain unread across leaving and re-entering the
filtered channel, and clear only after the filter is removed, the all scope
is selected, and the full tail is physically presented. Diagnostics, raw rail
snapshots, and IndexedDB are not a product oracle for this case.

Verification on this worktree:

- TC-0281 Chromium repeat 3: **3/3 passed** (`19.5s`).
- Adjacent TC-0280 and TC-0282 Chromium repeat 3: **6/6 passed** (`37.5s`).
- Focused notification units (`notification-fallback`,
  `notification-state-contract`, `nr02-canonical-frontier`, and
  `sz187-notification-following-boundary`): **30/30 passed**.
- Vite production build: **passed** (normal large-chunk warnings only).

No product source, vendor/package file, fixture, second cursor/store, or
compatibility path was changed. The only implementation change is the
existing browser spec's public-DOM assertions; this is the final closeout.
