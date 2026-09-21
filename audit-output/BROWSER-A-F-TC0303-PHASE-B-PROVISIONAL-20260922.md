# Browser A–F — TC-0303 / B-BR-05 provisional and terminal authority

## Atomic claim

- **Case:** `TC-0303` / `B-BR-05`.
- **Baseline:** `fae8b70:tests/browser/phase-b.spec.js:253` —
  `B-BR-05 完整 provisional、命名空间状态和第一终态权威性`.
- **Current base:** `756d44513d1937c0c65406bf9b1de3d8724d3bd1`.
- **Branch:** `codex/browser-af-tc0303-756d445`.
- **Worktree:**
  `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.tmp-browser-af-tc0303-756d445`.

This is a single A–F browser claim for the next uncredited B-BR baseline.
Only this audit report and the eventual dedicated `tests/browser` successor
and fixtures may be changed; product source, vendor, package/lock files, and
existing tests remain out of scope.

## Public user contract

The authenticated user sends a normal Composer message through the real
Workspace surface. The public conversation must then show the provider's
provisional business state and its eventual `PONG` terminal. A fresh
`terminal-conflict` run must likewise show the first terminal `PONG` as the
authoritative result and must not expose a later conflicting `FAILED` state.
The browser successor will use only public text/roles and the real Composer
send path; no private store, diagnostic event, websocket frame, or selector
substitute is an acceptance gate.

## Exact uniqueness precheck

1. The migration ledger has one retained `TC-0303` row for the baseline above;
   its target path is absent and the row is static/unverified.
2. Exact searches across current refs, registered worktrees, audit reports,
   and browser specs found no earlier `TC-0303`, `B-BR-05`, successor, branch,
   or commit claim. Existing `TC-0301` self mapping and `TC-0302` live-echo
   identity are separate B-BR-04 declarations; `TC-0304` onward are separate
   receipt/provisional declarations. This claim does not duplicate them.
3. The old `phase-b.spec.js` case has two public scenario legs
   (`business-provisional` and `terminal-conflict`); the successor will retain
   both strict user-visible outcomes rather than collapsing the case to a
   smoke assertion.

## Verification plan

The dedicated successor will reset the public mock to `business-provisional`,
login, send one ordinary message, and assert its public turn shows the
provider waiting/provisional bubble followed by `PONG`. It will then reset to
`terminal-conflict`, clear only the existing product cache through the public
browser context, reload, send a second message, and assert the latest turn
shows `PONG` with no visible `FAILED` terminal. Repeated Chromium evidence and
`npm run build` will be appended to this report. Any first public divergence
will be reported to the existing Workspace/Feed owner without changing the
product or weakening the contract.

**Reservation status:** claimed; no product change is authorized by this
report.

## Closeout evidence

- Reservation commit: `ac73b1c13d654d0b26e872f44fe4cbe3a94491ec`.
- Dedicated successor: `tests/browser/tc0303-phase-b-provisional.spec.js`.
- Exact Chromium command:
  `ATOLL_TEST_WEB_PORT=17133 ATOLL_TEST_MOCK_PORT=26133 npx playwright test
  tests/browser/tc0303-phase-b-provisional.spec.js --repeat-each=3
  --workers=1 --reporter=line`; result `3 passed (25.5s)`.
- Public evidence: the `business-provisional` leg rendered the submitted
  public turn and its `PONG` terminal; the fresh `terminal-conflict` leg
  rendered `PONG` as the latest terminal and exposed no `FAILED` label. The
  test used only public roles/text and Composer actions.
- `npm run build`: passed (`vite v8.0.16`, 4306 modules, 3.23s); only the
  existing large-chunk warning was emitted.
- Result: `PASS` / browser migration accepted. No product gap was found.
- Scope audit: only this report and the dedicated spec changed; no `src/`,
  vendor, package/lock, existing test, fixture, skip, or weakened assertion
  was added.
