# Browser N–S TC0359 — public following↔browsing handoff successor

Date: 2026-09-22  
Reviewer: Browser N–S independent reviewer  
Baseline: `fae8b70:tests/browser/q-following-tail-frames.spec.js:440`  
Reservation: `f7c5c06`  
Final test/audit commit: the commit containing this report and the successor spec  
Product base: `b71eb75`

## Verdict

**ACCEPT — public successor passes focused Chromium and repeat3.** No
user-visible regression was observed. The verdict uses only public Workspace
DOM, mode, scroll geometry, focus, and rendered-row hit testing; it does not
read diagnostic journals, React internals, private callbacks, writer
interceptors, or retired dual-list names.

## Public contract migrated

On a fresh `long-running-history` Workspace session, twelve real tail arrivals
provide enough content for a genuine browsing move. Ten ordinary user wheel
cycles then perform following → browsing → following. Each cycle requires:

1. browsing is published after the upward wheel and retains a non-empty,
   focused public reading owner;
2. the downward wheel returns to following and the physical tail distance is
   at most 24 CSS px;
3. the latest rendered message remains publicly reachable after the return; and
4. the public active owner never paints a blank or unhit-testable frame during
   the sampled handoffs.

The 24px bound is the existing public tail-geometry tolerance. The rAF sampler
records public DOM frames across the real wheel actions but does not require a
fixed number of frames or timing budget.

## Evidence

Focused Chromium: 1/1 PASS.  
Repeat Chromium: 3/3 PASS (four total runs including focused).

| run | sampled frames | non-empty frames | blank frames | bad following frames | each browsing gap | each return gap | final | page errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| focused | 436 | 436 | 0 | 0 | 260 | 1 | following / 1 | 0 |
| repeat 1 | 471 | 471 | 0 | 0 | 260 | 1 | following / 1 | 0 |
| repeat 2 | 513 | 513 | 0 | 0 | 260 | 1 | following / 1 | 0 |
| repeat 3 | 493 | 493 | 0 | 0 | 260 | 1 | following / 1 | 0 |

Every run completed all ten cycles. The focused and all repeat runs retained
focus on the public owner, mounted 67 rows at the final state, and kept the
latest tail marker visible after every return. Build: `npm run build` PASS
(Vite 8.0.16; 4306 modules transformed).

## Boundary and ownership

There is no first user-visible failure on `b71eb75`: every sampled active owner
had at least one hit-testable row, browsing exposed the intentionally displaced
gap, and each ordinary downward wheel restored following at the tail. The old
baseline's private scroll-write and frame-threshold assertions are deliberately
not migrated; their visible consequence—blank paint or an incorrect handoff
position—is the public successor's oracle.

## De-duplication

Before reservation, the central ledger, all repository BROWSER/R audit reports,
refs, worktrees, and commit subjects were searched for TC0359 and the old source
path. None contained an existing TC0359 claim. TC0358 (`c1ca28a`) covers
following-tail content growth, not repeated mode handoff. TC0357 covers a
separate tail re-entry/high-water path. T–Z's browsing/Waiting case covers
queued-task completion and channel exit, while N-S F7 covers cross-channel
session identity; neither is this ten-cycle same-channel contract. TC0227–0230,
including TC0228, remain excluded because E–H R38 and the central ledger cover
them.

Only this browser successor and this audit report were added; product, vendor,
package, fixture, mock, and skip files are unchanged.

