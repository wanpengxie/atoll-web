# Browser N–S — TC-0314 processing-edit migration

## Provenance and scope

- **Baseline:** fae8b7010afd1b3a950bc455ba6a577b65378cda
  (tests/browser/phase-c.spec.js:159, C-BR-03a)
- **Exact current base:** 357de99c273e1e9da1cd87e95eb20465b627e7a2
- **Reservation:** 2f0151141850d82745a27c4c647b88a52764c2eb
- **Successor:** tests/browser/tc0314-phase-c-processing-edit.spec.js
- **Owner boundary:** public Composer processing-edit handoff plus the
  mounted Reading stack in WorkspaceApp

The reservation scan covered all reachable refs, registered worktrees, tracked
browser specs, and audit-output/. No prior TC-0314/C-BR-03a successor or
claim was present. The neighboring Waiting/interrupt declarations
TC-0315–TC-0318 and the T–Z TC-0313/TC-0319 claims are separate contracts.
ad027-processing-edit.spec.js remains an adjacent owner probe with an
additional imperative-scroll assertion; it is not used as the TC-0314 verdict.

Only this test and audit report are changed. There is no product, vendor,
package, lockfile, mock, fixture, skip, diagnostic, or timeout-threshold
change.

## Public contract

The current successor retains the old user trajectory:

1. reset the public long-running scenario with seed 139;
2. log in and open the visible Steward member context;
3. send a task and place an ordinary unsent draft in the public Composer;
4. enter edit mode from the processing turn;
5. require the same public .timeline-reading-stack, focused edit Composer,
   and data-viewport-mode='following' timeline;
6. cancel the edit and require the ordinary draft, Composer focus, the same
   Reading stack, and following mode to remain.

The verdict uses only real Chromium actions and public DOM/accessibility
observations, plus the browser public pageerror channel. It does not read
React state, diagnostics, private stores, fibers, or owner callbacks.

## Exact evidence

Focused Chromium on the detached worktree:

```text
ATOLL_TEST_WEB_PORT=25114 ATOLL_TEST_MOCK_PORT=18914 \
npm run test:browser -- tests/browser/tc0314-phase-c-processing-edit.spec.js \
  --workers=1 --reporter=line \
  --output=test-results-tc0314-focused-357de99
# 1 passed (8.1s)
```

Fresh Chromium repeat-3 on the same exact base:

```text
ATOLL_TEST_WEB_PORT=25115 ATOLL_TEST_MOCK_PORT=18915 \
npm run test:browser -- tests/browser/tc0314-phase-c-processing-edit.spec.js \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-tc0314-repeat3-357de99
# 3 passed (52.4s)
```

The focused and repeat runs reported zero page errors. npm run build also
passed on the same detached worktree (4306 modules transformed, built in
8.26s).

## Decision

**ACCEPT — test-only public migration.** The exact C-BR-03a user contract is
green 1/1 focused and 3/3 fresh repeat. No product regression is opened.
