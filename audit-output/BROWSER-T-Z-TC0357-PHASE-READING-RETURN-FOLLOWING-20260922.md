# Browser T–Z — TC0357 wheel return-to-following successor

## Baseline alignment

- **Baseline:** `fae8b70:tests/browser/q-diag-return.spec.js:12`
- **Old user contract:** after leaving the live tail, ordinary wheel-down input
  returns the reader to the live tail and the final viewport is `following`.
- **Current owner:** the existing Timeline/Reading active list and public
  viewport-mode projection. No product, vendor, protocol, fixture, or
  scroll-writer code was changed.

The historical diagnostic recorded private writer traces. The successor keeps
the user-observable contract: it appends real readable tail entries, performs
real wheel-up input to enter browsing, performs repeated real wheel-down input,
then requires `following`, bounded tail gap, and the newest appended row
visible. It does not use private diagnostics or writer-count oracles.

## Reservation and uniqueness

- **Reservation base:** `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`
- **Reservation commit:** `e2a44e4f78c4fad1a0cb84e57b586c7f3d946613`
- **Worktree:** `/tmp/atoll-web-tc0357-claim-73413e2` (detached)
- No TC0357 successor, reservation, branch, or worktree was found before this
  claim. TC0259 explicit jump-latest and live-tail append contracts remain
  distinct; they do not cover wheel-down return from browsing.
- Space, SZ189, SZ212, and SZ215 domains are outside this packet.

## Public successor

`tests/browser/tc0357-phase-reading-return-following.spec.js` uses the
`long-running-history` mock scenario, submits twelve readable tail entries,
confirms the reader leaves tail on real wheel-up input, then sends fourteen
real wheel-down events. It asserts the public browsing→following transition,
tail gap ≤24px, and visibility of the exact newest request row.

## Verification

- **Chromium:** `ATOLL_TEST_WEB_PORT=15461 ATOLL_TEST_MOCK_PORT=19461 npx playwright test tests/browser/tc0357-phase-reading-return-following.spec.js --repeat-each=3 --workers=1` — **PASS 3/3** (24.4s).
- **Build:** `npm run build` — **PASS** (4,306 modules; existing chunk-size advisory only).
- **Scope:** test and audit files only; no product changes, skip deletion, or
  assertion-threshold weakening.
