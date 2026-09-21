# TC-1207 / SZ-040 — receipt-before-feed settles once

## Claim and uniqueness

This is the single current-owner claim for numeric case **TC-1207** and alias
**SZ-040**. The migration ledger maps the row to
`fae8b70:tests/submission-outbox.test.jsx:502`:

> receipt-before-feed is one attempt; rejection and retry remain user decisions

No other current audit report or branch in the inspected Composer/Submission
pool claims TC-1207/SZ-040. The neighboring rows are separate contracts:

- TC-1201/SZ-034 covers a queued intent rejected by a retired or revoked
  channel while preserving its draft;
- TC-1202/SZ-035 covers access changing during an already wire-started send;
- TC-1204 covers uncertain reconnect retry bounding;
- TC-1206 covers the opposite feed-before-receipt ordering.

This claim does not promote any of those neighboring rows.

## User contract and owner

The user has submitted one message. The server receipt arrives before the
message is observed in the channel feed. The Composer submission owner must:

1. keep the one durable client message identity for that attempt;
2. expose the accepted receipt as an accepted pending row until the feed
   identity is observed;
3. remove that row exactly once when `reconcileFeed` observes the message; and
4. never transmit the same identity again or silently decide rejection/retry
   on the user's behalf.

The sole owner is `useComposerSubmissionRuntime`, backed by the generic
`createOutboxStore`. The public test drives `send`, `pending`, and
`reconcileFeed`; it does not call a private reducer, restore a retired store,
or delegate identity to roster/feed.

## Evidence

The existing current-owner test at
`tests/submission-outbox.test.jsx:215-225` is the exact public successor of
the historical case. It sends `m-receipt-first`, waits for the accepted
receipt, reconciles the feed identity, then asserts the pending row is gone
and `submit` was called exactly once.

On base `8002bd3836b26c2cf7a98f71ec7e73d697d5cc57`, branch
`codex/composer-tc1207-receipt-first-8002bd`:

```text
npx vitest run tests/submission-outbox.test.jsx -t 'receipt-before-feed' --reporter=dot
5 consecutive runs: 1 passed, 8 skipped each run

npx vitest run tests/submission-outbox.test.jsx \
  tests/submission-outbox-current.test.jsx \
  tests/submission-outbox-sendlease-contract.test.jsx --reporter=dot
3 files, 32 tests passed

npm run build
passed (Vite production build)
```

No `src/`, Workspace, Feed, Roster, vendor, package/lockfile, backend,
protocol, store, or compatibility owner changed. This is a test/audit-only
closure of the one previously unclaimed ledger row.
