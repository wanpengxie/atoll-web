# Browser T–Z — TC0340 Reading reverse-entry successor

## Baseline alignment

- **Baseline:** `fae8b70:tests/browser/post-entry-upward-jump-stage2.spec.js:215`
- **Old user contract:** after entering `c0.project`, a real upward wheel moves
  the user into browsing and paints the first reverse-history surface without
  leaving the active reading surface empty or stuck in loading.
- **Current owner:** the existing Timeline/Reading surface and its active
  reading layer. No product, vendor, protocol, fixture, or scroll-owner code
  was changed.

The historical test used private write/diagnostic probes to explain the
handoff. The successor keeps the user-observable gates: real pointer input,
`data-viewport-mode="browsing"`, a visible active row after each wheel, the
expected historical message visible exactly once, and no visible loading
state. The test intentionally does not assert the implementation-specific
`data-reading-container` value.

## Reservation and uniqueness

- **Reservation base:** `390fa3af9cc7e34c15f1e7e2b9197843376c6021`
- **Reservation commit:** `8bfb8a4eb29fffd5d73673e4114e56bc57700834`
- **Worktree:** `/tmp/atoll-web-tc0340-claim-390fa3a` (detached)
- TC0300 was excluded because another detached worktree already held its
  claim. TC0331/0332 and TC0334–0339 were also excluded as existing or active
  claims. Waiting, Space, and SZ212 contracts are outside this packet.

## Public successor

`tests/browser/tc0340-phase-reading-reverse-entry.spec.js` resets the delayed
deep-history scenario with the old seed, logs in through the public UI, opens
`c0.project`, performs four real upward wheel events, and checks:

1. every wheel leaves a visible row in the active reading layer;
2. the timeline enters `browsing` mode;
3. `c0.project history 119: ask project-agent for PONG` is visible exactly once;
4. the active list has no visible `加载中` state.

## Verification

- **Chromium:** `ATOLL_TEST_WEB_PORT=15444 ATOLL_TEST_MOCK_PORT=19444 npx playwright test tests/browser/tc0340-phase-reading-reverse-entry.spec.js --repeat-each=3 --workers=1` — **PASS 3/3** (23.4s).
- **Build:** `npm run build` — **PASS** (4,306 modules; existing chunk-size advisory only).
- **Scope:** test and audit files only; no product changes and no assertion skip/threshold weakening.
