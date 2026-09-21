# Browser N–S TC0358 — public following-tail successor

Date: 2026-09-22  
Reviewer: Browser N–S independent reviewer  
Baseline: `fae8b70:tests/browser/q-following-tail-frames.spec.js:184`  
Reservation: `81d1872`  
Final test/audit commit: the commit containing this report and the successor spec  
Product base: `b0fb510bd9099eece83d2d70b1fce4d2eb4e5027`

## Verdict

**ACCEPT — public successor passes focused Chromium and repeat3.** No product
regression was observed. The browser evidence is limited to public Workspace
DOM and user-visible geometry; no diagnostic journal, React internals, writer
interceptor, private callback, or fixed frame-count oracle participates in the
verdict.

## Public contract migrated

On a fresh `long-running-history` Workspace session, the active reading owner
starts in `following`, then receives six real `q_tail_append` arrivals with
progressively different visible content heights. For every sampled public
following frame:

1. the active timeline remains in `following`;
2. the physical tail distance (`scrollHeight - clientHeight - scrollTop`, or
   the equivalent following-tail origin) is at most 24 CSS px;
3. at least one row is visible and hit-testable in the active reading owner;
4. each appended request has exactly one public presentation row containing its
   marker; and
5. the run has no browser `pageerror`.

The 24px bound is the existing public tail-geometry tolerance used by the
current reading-owner contracts. The sampler runs across the real arrival and
layout work; it does not require a particular number of animation frames.

## Evidence

Focused Chromium: 1/1 PASS.  
Repeat Chromium: 3/3 PASS (four total runs including focused).

| run | sampled frames | following frames | bad tail frames | blank frames | final mode/gap | page errors |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| focused | 105 | 105 | 0 | 0 | `following` / `0` | 0 |
| repeat 1 | 98 | 98 | 0 | 0 | `following` / `0` | 0 |
| repeat 2 | 96 | 96 | 0 | 0 | `following` / `0` | 0 |
| repeat 3 | 97 | 97 | 0 | 0 | `following` / `0` | 0 |

Each run delivered six arrivals and ended with 67 mounted presentation rows;
each arrival marker was observed exactly once. The current public owner reports
`data-reading-container="conversation-list"`; this is recorded as evidence,
not asserted as the retired `FollowingTailList` implementation name.

Build: `npm run build` PASS (Vite 8.0.16; 4306 modules transformed). Only the
test spec and this audit report are added; product, vendor, package, fixture,
mock, and skip files are unchanged.

## Boundary and ownership

There is no user-visible first failure on `b0fb510`: the active reading owner
keeps a non-empty hit-tested surface at the physical tail throughout all
captured arrival/layout frames. The old baseline's “no app write touches the
scroller” assertion is intentionally not carried over because it is an
implementation/private oracle; the visible consequence (no tail gap or blank
frame) is what this successor proves.

## De-duplication

Central ledger and all repository audit reports were searched before the
reservation. No existing report, ref, worktree, or commit claims TC0358 or
`q-following-tail-frames.spec.js`. TC0357 (return-to-following/high-water),
TC0361 (keyboard handoff), and N1 (notification badge/high-water) are distinct
contracts. TC0227–TC0230, including TC0228, were excluded because E–H R38 and
the central ledger already cover them.
