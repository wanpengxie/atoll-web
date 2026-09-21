# TC-1208 / SZ-041 — landed id survives principal hydration ordering

## Claim and uniqueness

This is the single current-owner claim for numeric case **TC-1208** and alias
**SZ-041**. The migration ledger maps the row to
`fae8b70:tests/submission-outbox.test.jsx:533`:

> a ledger-confirmed message must not be resurrected when feed acknowledgement
> races principal hydration

The inspected Composer/Submission refs and audit packets contain no
TC-1208/SZ-041 closure. The stale numeric migration ledger marked this row
green based on a focused candidate run, but did not provide a distinct
current-owner closure packet. This report supplies that missing provenance;
it does not add a second implementation or duplicate a neighboring row.

The nearest rows remain separate:

- TC-1207/SZ-040 is receipt-before-feed settlement;
- TC-1206/SZ-039 is feed-before-receipt settlement;
- TC-1209/SZ-042 is the explicitly unsupported legacy-migration variant;
- TC-1210/SZ-043 is immutable frame acceptance versus a newer draft.

## User contract and owner

If the channel feed has already confirmed a client message while the Composer
runtime is still hydrating the principal's durable outbox, that identity is a
landed fact. The user must not see it queued again, and reconnect must not send
it a second time. The accepted feed fact may consume the matching durable row,
but it must not consume or alter an unrelated newer draft.

The sole owner is `useComposerSubmissionRuntime`, with `createOutboxStore` as
the generic durable queue. The current public test drives the runtime's
`reconcileFeed`, `pending`, `send`/wire lifecycle, and durable `restore`; it
does not call a private reducer, restore the retired submission store, or
delegate identity to roster/feed.

## Evidence

The existing current-owner test at
`tests/submission-outbox.test.jsx:229-255` pre-seeds a queued durable row,
reports the matching feed identity before hydration finishes, then reopens
the wire. It observes all required terminal facts: no pending resurrection,
zero transport submissions, and no matching durable row after reconciliation.

On base `bf119bb77358598762d2a6b124b0d062459cb4e3`, branch
`codex/composer-tc1208-hydration-race-bf119bb`, worktree
`.tmp-tc1208-hydration-race-d054696`:

```text
npx vitest run tests/submission-outbox.test.jsx \
  -t 'ledger-confirmed id when feed races principal hydration' --reporter=dot
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
closure of the one previously unpacketized current-owner row.
