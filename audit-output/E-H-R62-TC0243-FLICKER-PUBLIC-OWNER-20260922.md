# E–H R62 — TC0243 public-owner migration

## Claim and uniqueness

Claimed on current `e60b20a9043594aaaa7064cac93782acae3cadf4` in the detached
worktree `atoll-web-tc0243-current-e60b20a`.

The exact baseline is
`fae8b70:tests/browser/flicker-investigation.spec.js:146`, titled
`before: compositor and DOM remain continuously covered during history prepend`.
The old test's `tests/browser/fixtures/reading-viewport.html/.jsx` owner was
removed by `36fa48f` (`test(web): remove retired browser fixtures`); no current
fixture or production path imports it.  The following nearby tests were checked
as aliases/bridges and are not semantic duplicates:

| Existing path | Overlap | Why it does not cover TC0243 |
|---|---|---|
| `tests/browser/history-reveal-prototype.spec.js` case “history reveal keeps one spatial owner…” | real AppShell, active-list and sampled visible-row checks | It has no compositor oracle and no five-way prepend timing/geometry matrix. |
| `tests/browser/f7-history-water-baseline-0210-0211.spec.js` TC0211 | mixed-height runway, rAF rows, CDP paint | It proves one runway scenario and its demand/settle contract, not the old concurrent/no-history/stationary burst cases. |
| `tests/browser/f7-history-water-baseline-0212-0216.spec.js` TC0212 | CDP paint and visible rows | It is one extreme-height record/fold scenario, not history-prepend coverage across the TC0243 timing matrix. |

Therefore TC0243 remains one unclaimed baseline contract.  The new test does
not restore the retired fixture, create a second owner, or use diagnostic event
names as a success oracle.

## Required case record

### Baseline setup, action, observable

The old test opened the isolated `reading-viewport` fixture, moved its list near
the history edge, installed a rAF/MutationObserver probe, started a CDP
`Page.startScreencast`, and drove a short native wheel burst.  For concurrent
cases it scheduled `readingFixture.prepend()` at different delays; it also ran
no-history and stationary variants.  After the burst it sampled every rAF and
decoded each JPEG.  Its observable result was zero DOM coverage violations and
zero compositor blank paints; a soft DOM failure was still a test failure and
the compositor failure was hard.

The current migration preserves that user action and observable through the
real `/` AppShell.  `moveToHistoryEdge()` uses ten physical `page.mouse.wheel`
actions; the observed burst uses the matrix below.  The probe only reads public
DOM (`.timeline-message-list`, `.timeline-reading-layer.is-active`, and
`[data-presentation-row-id]`).  CDP paint is independently cropped to the
message viewport and compared with the measured list background, so a fixed
status/control cannot count as message coverage.

| Current public scenario | Old timing class represented | Action matrix |
|---|---|---|
| `deep-history-delayed` / `delayed-fast-burst` | concurrent prepend, short delay | `[-700,-900,-1300,-1700]`, 12 ms |
| `deep-history-delayed` / `delayed-late-prepend` | concurrent prepend, late arrival | `[-900,-1400,-1900,-2200]`, 8 ms |
| `deep-history-delayed` / `delayed-slow-burst` | concurrent prepend, slower input | `[-1100,-1600,-2100,-2500]`, 32 ms |
| `mixed-height-history` / `variable-height-prepend` | prepend while row geometry changes | `[-1100,-1600,-2100,-2500]`, 6 ms |
| `history-boundary` / `history-boundary-burst` | no-more-history/stationary boundary path | `[-2700,-1200]`, 0 ms |

The old `historyFixture` controls have no public equivalent and are not called;
the current matrix is the smallest real-user replacement that covers the same
input race, delayed supply, geometry variation, and exhausted-boundary classes.

### User-visible capability

While a user is browsing upward, history pages may arrive and prepend while a
wheel burst is still in flight.  The user must never see an empty or uncovered
reading surface: existing message content stays visibly painted while the
list grows or its measured row geometry changes.

### Architectural invariant

There is exactly one active reading layer/list for the committed channel.  Each
sampled frame must have a connected root, one active layer/list, at least one
visible presentation row with an ID, and no uncovered bottom viewport or
hidden/zero-opacity root or list.  At the history start, the production
`.timeline-history-boundary-slot` is a real 35px reserve.  The test measures
that slot's bottom from its content origin on every frame and defines the top
gap as `firstVisibleRow.top - measuredBoundaryBottom`; only a gap greater than
the 2px subpixel tolerance is uncovered.  This keeps the reserve explicit
without making a fixed 35px assumption.  Independent compositor frames must
retain foreground message pixels; zero frames fail closed and a frame with
foreground below the measured 5%/100-pixel floor is a blank paint.  No history
diagnostic, private token, or extra list is accepted as a substitute.

### Current production owner and public entry

The public entry is `/` → login → `.timeline-message-list` in the committed
ConversationSurface.  The owner chain is:

- Reading/presentation admission and intent ownership:
  `src/ui/timeline/useConversationProjection.js` (`useProjectionReadingOwner`);
- history supply and bounded prepend demand:
  `src/ui/timeline/useHistoryConsumer.js` (`useHistoryConsumer`);
- the sole DOM/geometry executor:
  `src/ui/timeline/VendorListExecutor.jsx` (`VendorListExecutor`), reached by
  `ReadingContainerHandoff`.

The test asserts only the resulting public DOM and compositor state.  The first
current divergence is the `VendorListExecutor`/Reading presentation geometry
handoff after a variable-height prepend; history supply itself is not treated
as proof of coverage.

## Current result and evidence

Test: `tests/browser/f7-flicker-baseline-0243.spec.js`.

Focused matrix run on `e60b20a` before the reserve-aware correction:

```text
ATOLL_TEST_MOCK_PORT=20086 ATOLL_TEST_WEB_PORT=15386 \
  npm run test:browser -- tests/browser/f7-flicker-baseline-0243.spec.js \
  --reporter=line --output=test-results-tc0243-split3

5 tests: 4 passed, 1 **REJECTED oracle regression**, 0 blocked.  The old
`first.top > 1` rule treated the production boundary reserve as uncovered.
```

The stable repeat before the reserve-aware correction was:

```text
ATOLL_TEST_MOCK_PORT=20087 ATOLL_TEST_WEB_PORT=15387 \
  npm run test:browser -- tests/browser/f7-flicker-baseline-0243.spec.js \
  --repeat-each=3 --reporter=line --output=test-results-tc0243-repeat3

15 tests: 12 passed, 3 **REJECTED oracle regressions**, 0 blocked.
```

The three old failures were all the same `variable-height-prepend` case.  The
first public assertion was a single sampled frame with:

```text
connected=true
activeLayers=1
activeLists=1
visible row=c0-history-request-44, top=35, bottom≈545
scrollTop=7255, scrollHeight=37698, clientHeight=487
uncoveredTop=true (old fixed `first.top > 1` rule)
```

The root and sole list remain connected and the frame is not empty; its first
row is at the production reserve boundary (`top≈35px`).  The slot's measured
bottom from the content origin is also `35px`, so its corrected top gap is
zero.  All three old artifacts report `blankPaints=[]`; this was not a
compositor-white product failure.  The old red was therefore rejected as an
oracle conflict, not handed to the Reading product owner.

Artifacts from those runs are retained under
`/tmp/tc0243-artifacts-e60b20a/test-results-tc0243-split3/` and
`/tmp/tc0243-artifacts-e60b20a/test-results-tc0243-repeat3/` after removing
generated output from the worktree.  The test does not read or assert private diagnostics;
the repeated red is therefore retained only as evidence for the rejected
fixed-threshold oracle; it is not a current product regression.

## Reserve-aware re-verification

The test now measures
`boundarySlot.getBoundingClientRect().bottom - boundarySlot.parentElement.getBoundingClientRect().top`
on every rAF sample.  The variable-height case that previously red at
`first.top≈35px` now has `topGap=0`; the empty-viewport, connected-list,
active-layer/list, row-ID, root/list visibility/opacity, bottom-coverage, and
independent CDP `blankPaints=[]` gates are unchanged.

```text
ATOLL_FLICKER_SEED=9268 ATOLL_TEST_MOCK_PORT=20187 ATOLL_TEST_WEB_PORT=15187 \
  npx playwright test tests/browser/f7-flicker-baseline-0243.spec.js \
  --workers=1 --reporter=line --output=/tmp/tc0243-reserve-variable2

1 passed (10.9s)

ATOLL_TEST_MOCK_PORT=20188 ATOLL_TEST_WEB_PORT=15188 \
  npx playwright test tests/browser/f7-flicker-baseline-0243.spec.js \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/tc0243-reserve-repeat3

15 passed (1.5m)
```

## Rejected old-oracle reproduction (kept for auditability)

The former fixed-threshold false red can be reproduced with:

1. Reset the public mock to `mixed-height-history` with seed `0x2434`.
2. Log in through `/`; hover `.timeline-message-list`.
3. Wheel upward ten times by `2400` with 18 ms between setup inputs.
4. Start the public DOM frame probe and CDP screencast.
5. Wheel `-1100, -1600, -2100, -2500` with 6 ms between inputs; wait 520 ms.
6. Observe one frame where the connected sole list's first row begins at the
   35px HistoryStartBoundary reserve.  The old oracle reports `uncoveredTop`,
   while the reserve-aware oracle reports `topGap=0` and compositor foreground
   remains present.

No product handoff remains from this evidence: the architecture decision is
that the 35px slot is intentional HistoryStartBoundary reserve.  No product
code was edited, and no case was deleted, skipped, or weakened.

## Verification boundary

- Pre-correction Chromium matrix: 4 PASS / 1 rejected fixed-threshold oracle.
- Pre-correction repeat-each=3: 12 PASS / 3 rejected fixed-threshold oracles.
- Reserve-aware Chromium variable-height: PASS.
- Reserve-aware full matrix repeat-each=3: 15 PASS / 0 product regressions.
- No test-only private export, compat path, second store, or second owner was
  added.
- `npm run build`: PASS (4306 modules transformed; Vite build completed).
- This change is test/audit-only.
