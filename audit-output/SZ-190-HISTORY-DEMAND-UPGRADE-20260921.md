# SZ-190 history-demand upgrade

## Verdict

**ACCEPT on candidate `7acfe8755c8f09c593b6a02ea7e247556797e29f`** for the
current public-owner contract. The candidate adds one strict public projection
test and no product change.

## Unique baseline and scope

The numeric ledger records SZ-190 as the retained S19 case:

> 真实上滚会把同一个 anticipatory 历史 operation 升级为可见 interactive
> demand

The exact fae baseline is `fae8b70:tests/timeline-reading-integration.test.jsx`
(the case immediately before the SZ-191 EOF/reservoir case). SZ-184 is not a
duplicate: it covers saved-bookmark cancellation on unmount and retry of the
same immutable target. SZ-190 covers priority upgrade of one active scroll
history operation.

## Current owner and user contract

The only current owner is the public `useConversationProjection` viewport,
delegating typed history demand to `useHistoryConsumer` and the supplied
`history.request` port. The test does not import or call a private controller
function.

The user-visible contract is:

1. A visible underfill starts one `scroll-history` request at
   `anticipatory` urgency.
2. Before that operation settles, reaching the physical top upgrades that
   same active operation to `interactive` urgency.
3. The request port is invoked exactly once; the operation receives exactly
   one `{ intent: 'scroll-history', urgency: 'interactive' }` promotion.
4. Repeated top evidence does not create another physical request or another
   promotion.
5. The pending operation can settle normally without a second store, timer,
   owner, or compatibility path.

The operation callback is observed at the existing typed request-port boundary
(`history.request({ ..., onOperation })`); no internal function or export is
used. Promise identity is intentionally not asserted because the current top
port may return a continuation wrapper while still joining the one physical
operation.

## Evidence

Added [`tests/sz190-history-demand-upgrade.test.jsx`](/tmp/sz190-history-demand-fMS8I7/tests/sz190-history-demand-upgrade.test.jsx)
with the exact sparse filtered-row shape from the fae scenario. The focused
test passed and observed one request, one promotion, and no duplicate on a
second top signal.

Commands on this exact candidate:

```text
npm test -- --run tests/sz190-history-demand-upgrade.test.jsx
  Test Files  1 passed; Tests 1 passed

npm test -- --run tests/sz190-history-demand-upgrade.test.jsx \
  tests/sz191-eof-reservoir-reopen.test.jsx \
  tests/sz100-103-reading-history-public-owner.test.jsx \
  tests/history-demand.test.js
  Test Files  4 passed; Tests 11 passed

npm run build
  ✓ built in 2.74s
```

No `src/`, vendor, package, lockfile, notification, or Feed files were
modified. This worktree is intentionally parallel to SZ-184; integration must
rebase this single test/audit commit serially against the then-current head.
