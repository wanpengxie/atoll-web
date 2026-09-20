# N–R Round 44 — TC0224 settled-before anchor contract

Date: 2026-09-20  
Reviewed current head: `5f523ce` (contains the exact `0ba7fa7` Reading
candidate and subsequent audit/test-only commits)

## Contract correction

The public TC0224 black box in
`tests/browser/n-r-round41-reading-restore-blackbox.spec.js` now has two
independent geometry gates:

1. **Before/settled anchor:** capture the public row ID and `before.top` before
   leaving the channel; after return, take the last visible frame for that same
   row as settled and require
   `abs(settledTop - before.top) <= 2px`.
2. **In-return stability:** every visible sampled frame must keep the same row
   ID, and the visible-frame top spread must be `<=2px`.

The evidence object records `before`, all sampled frames, `settledTop`,
`settledDelta`, and `spread`. The test still uses only public channel clicks,
wheel input, DOM row geometry, and requestAnimationFrame sampling; it does not
call a private owner, diagnostics, `runtime.bind`, or a manually injected
bookmark/session.

## Latest exact verification

```text
ATOLL_TEST_WEB_PORT=17018 ATOLL_TEST_MOCK_PORT=19018 \
  npx playwright test tests/browser/n-r-round41-reading-restore-blackbox.spec.js \
  --repeat-each=3 --reporter=line
```

Result: **3 passed**. This confirms the candidate satisfies both the settled
position gate against the pre-leave `before.top` and the frame-to-frame spread
gate across three independent runs.

## NR19-01 companion recheck

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=dot
```

Result: **1 file, 7 tests passed**. Absolute-path Markdown remains intercepted
by the current public preview command, ordinary web links remain `_blank` and
unprevented, and nested/recent panel behavior remains green.

## Baseline accounting

Round 44 adds no N–R baseline row. The Round 43 map remains the authoritative
one-to-one partition of 22 suites / 98 expanded rows. TC0224 is supplementary
browser geometry evidence, not a second NR13/NR14 row; NR19-01 is a rerun of its
existing row, not a new right-panel case.

## Boundary audit

Only the test contract and this audit are in scope for Round 44. No product,
Reading owner, vendor, package, or lockfile file was edited; no test was
deleted/skipped and no private API was exported/imported.
