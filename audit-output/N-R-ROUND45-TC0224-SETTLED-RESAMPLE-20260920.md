# N–R Round 45 — TC0224 settled resample proof

Date: 2026-09-20  
Product candidate under test: `45b0fcb` (`fix(reading): fence document
visibility re-entry`)  
Workspace audit head after concurrent test-only commits: `d463019`

## Contract correction

The TC0224 public black box now separates the two observations:

- the rAF sampler's `frames` are used only for the in-return visibility and
  frame-spread contract;
- after `waitForVisibleAnchor(viewport, before.id)` completes, the test performs
  a fresh DOM query for that exact row (`captureSettledAnchor`), records its
  current `settledTop`, and computes
  `settledDelta = abs(settledTop - before.top)`;
- the settled sample must still be the same visible row, and
  `settledDelta <= 2px`; independently, the old sampled visible frames must
  have `spread <= 2px`.

This prevents an old `frames.at(-1)` value from being mislabeled as the settled
position. The `before` object remains the public pre-leave anchor record and is
included in the evidence payload.

## Exact latest repeat

```text
ATOLL_TEST_WEB_PORT=17019 ATOLL_TEST_MOCK_PORT=19019 \
  npx playwright test tests/browser/n-r-round41-reading-restore-blackbox.spec.js \
  --repeat-each=10 --reporter=line
```

Result: **10 passed (1.1m)**. The run exercised the corrected post-wait
settled resample and the independent frame-spread assertion on every repetition.
One Vite proxy `ECONNRESET` informational line appeared during teardown/startup;
no test failed and the process exited zero.

The prior Round 44 NR19-01 check remains **7/7 passed** through the current
public right-panel owner; this round does not duplicate that baseline row.

## Boundary audit

Only the TC0224 test and this audit are in scope. No product, Reading owner,
vendor, package, or lockfile path was edited; no test was deleted or skipped;
no private owner/API was exported or imported.
