# Browser A–F — TC-0304 / B-BR-06 receipt/feed ordering

## Atomic claim

- **Case:** `TC-0304` / `B-BR-06`.
- **Baseline:** `fae8b70:tests/browser/phase-b.spec.js:274` —
  `B-BR-06 receipt 先到与 feed 先到都只产生一个请求`.
- **Current base:** `8002bd3836b26c2cf7a98f71ec7e73d697d5cc57`.
- **Branch:** `codex/browser-af-tc0304-8002bd3`.
- **Worktree:**
  `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.tmp-browser-af-tc0304-8002bd3`.

This is one previously uncredited A–F browser declaration. Only this report
and the eventual dedicated `tests/browser` successor/fixtures may change;
product source, vendor, package/lock files, and existing tests are out of
scope.

## Public user contract

The real Composer submission must produce one visible request/turn and one
visible `PONG` terminal regardless of whether the feed row arrives before the
receipt or the receipt arrives before the feed row. The browser successor
retains both public mock scenarios (`feed-delayed` and `receipt-delayed`),
uses only the public Composer and conversation surface, and asserts the
submitted text occurs exactly once after each ordering. No websocket frame,
private store, diagnostic event, or implementation-specific request counter is
an acceptance gate.

## Exact uniqueness precheck

1. The migration ledger has one retained `TC-0304` row for the baseline above;
   its target path is absent and remains static/unverified.
2. Exact searches across current refs, registered worktrees, audit reports,
   and browser specs found no prior `TC-0304`, `B-BR-06`, successor, branch,
   or commit claim. TC-0303/B-BR-05 is the separate provisional/terminal
   authority contract; TC-0305/B-BR-06a is the distinct roster-not-ready
   early-send contract; TC-0306/B-BR-07 is receipt-loss reconciliation.
   None is used as a substitute here.
3. The old declaration has two order-specific public legs. The successor will
   retain both strict exactly-once visible outcomes rather than collapsing the
   case to one ordinary send smoke.

## Verification plan

The dedicated successor will reset to `feed-delayed`, login, send a unique
message, and assert exactly one visible copy plus `PONG`. It will then reset to
`receipt-delayed`, clear only the existing product cache, reload, send another
unique message, and assert exactly one visible copy after the delayed receipt
settles. Chromium repeat evidence and `npm run build` will be appended here.
Any first public divergence will be reported to the existing Composer/Feed
owner; no product or assertion weakening is authorized by this claim.

**Reservation status:** claimed; no product change is authorized by this
report.

## Closeout evidence

- Reservation commit: `f6d1ccf5364757a23d222115428262edf5e5db2d`.
- Dedicated successor: `tests/browser/tc0304-phase-b-receipt-feed.spec.js`.
- Exact Chromium command:
  `ATOLL_TEST_WEB_PORT=17134 ATOLL_TEST_MOCK_PORT=26134 npx playwright test
  tests/browser/tc0304-phase-b-receipt-feed.spec.js --repeat-each=3
  --workers=1 --reporter=line`; result `3 passed (27.1s)`.
- Public evidence: both `feed-delayed` and `receipt-delayed` legs showed the
  submitted text exactly once and reached the visible `PONG` terminal. The
  test used only public roles/text and real Composer actions; socket-close
  messages during worker teardown were not used as product evidence.
- `npm run build`: passed (`vite v8.0.16`, 4306 modules, 2.98s); only the
  existing large-chunk warning was emitted.
- Result: `PASS` / browser migration accepted. No product gap was found.
- Scope audit: only this report and the dedicated browser spec changed; no
  product source, vendor, package/lock, existing test, fixture, skip, or
  weakened assertion was added.
