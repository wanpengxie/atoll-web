# SZ-282 public history progression successor

## Scope and decision

SZ-282 keeps the user-visible history capability: while the reader requests
older history, installed rows remain in stable sequence order, a repeated
physical fact does not produce a duplicate visible item, and the current
history demand exposes understandable `pending` and typed `error` states. A
successful user retry clears the error and returns the demand to `idle`.

The old scheduler reservoir/release choreography is not part of this contract.
The successor exercises only the existing public owner chain:

`useHistoryConsumer` → `ChannelFeedRuntime.loadHistory/historyFor` →
`ChannelReplica` → `selectTimelineItems` / rendered Presentation rows.

No new store, scheduler, cursor, compatibility path, private export, or source
owner was added. The current owner already satisfied the contract, so this
round contributes public successor tests and evidence rather than a mechanism
rewrite.

## Case contract and evidence

| Case | User capability | Public invariant | Current owner | Result |
| --- | --- | --- | --- | --- |
| SZ-282-A | Older pages can arrive in a different segment than the current tail. | Projection sequence is ascending and each visible identity occurs once. | `ChannelFeedRuntime.enqueue/pageEnd` + Replica + `selectTimelineItems`. | **PASS**: pages `[4,5,6]` then `[1,2,3]`; the repeated `seq=2` transport frame is not duplicated in the projection; visible result is `[1,2,3,4,5,6]`. |
| SZ-282-B | A reader knows that older history is waiting for authority and does not mistake it for EOF. | No-grant `loadHistory` returns typed `waiting/history-grant-pending`; `historyFor.historyDemand.phase` is `pending`. | `ChannelFeedRuntime.loadHistory/historyFor`; UI status is `useHistoryConsumer`/`ConversationSurface`. | **PASS**: unit assertion. |
| SZ-282-C | A failed older-history attempt is understandable and retryable. | Failed page publishes `historyDemand.phase=error`, `errorCode=history_failed`, and the server detail; a new public `loadHistory` retry creates the next demand and clears error after success. | `ChannelFeedRuntime` demand lifecycle + `useHistoryConsumer.retryHistoryDemand`. | **PASS**: unit assertion. |
| SZ-282-D | Real delayed history visibly progresses without duplicate/out-of-order rows. | During delayed supply the DOM exposes `data-phase="pending"` while existing rows remain; after the page arrives, rendered row IDs are unique and `data-seq-low` is ascending. | `useHistoryConsumer` + ConversationSurface + Timeline/Presentation row owner. | **PASS**: Chromium mock `deep-history-delayed`, one wheel, older row arrival, pending→settled. |

## Files and isolation

- Base: `bb08acb7ec0e1e41a129e493d3ea28076f1ce601`
- Branch: `unit-s-z/sz282-public-bb08acb`
- Worktree: `.worktrees/unit-s-z-sz282-bb08acb7ec0e1e41a129e493d3ea28076f1ce601`
- Added: `tests/sz-round61-sz282-history-progression.test.jsx`
- Added: `tests/browser/sz282-history-progression.spec.js`
- Added: this audit report
- Product/vendor/package/lockfile files: unchanged

## Verification

```text
npx vitest run tests/sz-round61-sz282-history-progression.test.jsx --reporter=dot
  Test Files  1 passed (1)
  Tests       2 passed (2)

ATOLL_TEST_WEB_PORT=25175 ATOLL_TEST_MOCK_PORT=25834 \
  npx playwright test tests/browser/sz282-history-progression.spec.js --reporter=line
  1 passed (6.9s)

npm run build
  ✓ built in 3.66s (4306 modules transformed)
```

The build emitted only the repository's existing chunk-size advisory; it
completed successfully.
