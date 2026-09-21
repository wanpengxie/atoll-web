# N–R — TC-1085 channel-isolated notification acknowledgement claim

Date: 2026-09-22
Claim base: `d054696b8cdc84ea24970f4c7469517e0604439f`

## Atomic claim and de-duplication

This worktree claims exactly one previously unclaimed Notification baseline:

- numeric key: **TC-1085**;
- old baseline declaration: `tests/notification-fallback.test.js:52`;
- current contract test: `tests/notification-state-contract.test.js:150`;
- user capability: acknowledging the active channel cannot clear another
  channel, and a non-caught-up observation leaves the active channel unchanged;
- current owner: `ChannelFeedRuntime`'s per-channel notification cursor and
  canonical `unreadFor` projection.

TC-0284 is reserved by the independent
`unit-e-h/tc0284-review-640d445` claim. TC-1080 through TC-1083 are already
claimed/closed or under independent review. TC-1084 is covered by the existing
NR02 actor-filtered contract and is deliberately not duplicated. Exact
TC-1085 searches across current-main history, registered worktrees, branches,
and audit files found no other claim, successor, or candidate.

## Contract migration

The old fixture used the retired weak projection shape. The current test uses
the existing public Feed surface:

1. grant and materialize two channels with one related root each;
2. submit a typed non-caught-up observation for the active channel and assert
   both channels remain unread;
3. submit a typed caught-up receipt only for the active channel; and
4. assert the active channel clears while the other channel remains unchanged.

The test therefore proves channel identity is part of the acknowledgement
boundary and that a negative/non-caught-up observation is not an implicit
acknowledgement. It does not add a second cursor, store, compatibility path,
or frontend substitute for server authority.

## Verification and scope

- `tests/notification-state-contract.test.js`: **20/20 passed**;
- focused notification owner set: **31/31 passed**;
- Vite production build: **passed** (normal large-chunk warnings only).

Only the existing owner contract test and this audit result changed. No
product source, vendor/package file, fixture, second cursor/store,
compatibility path, or other baseline test was changed.
