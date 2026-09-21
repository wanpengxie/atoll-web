# Browser N–S reservation: TC0358 / following-tail public contract

Date: 2026-09-22  
Reviewer: Browser N–S independent reviewer  
Baseline: `fae8b70:tests/browser/q-following-tail-frames.spec.js:184`  
Current base: `b0fb510bd9099eece83d2d70b1fce4d2eb4e5027`

## Claim

I reserve TC0358, the first currently unclaimed Browser N–S baseline after the
TC0227–TC0230 family: a following presentation remains at the public tail while
content/layout changes arrive. The successor will assert only user-visible DOM,
mode, tail geometry, and message reachability. It will not carry forward the
old private scroll-write interceptor, diagnostic globals, frame-count thresholds,
or implementation-specific `FollowingTailList` assertions.

## De-duplication performed before reservation

- `audit-output/TEST-CASE-MIGRATION-LEDGER.md` is the only repository hit for
  `TC-0358` or `q-following-tail-frames`.
- No other `audit-output` report names TC0358, TC0359, TC0360, or the old
  `q-following-tail-frames.spec.js` source.
- No ref, worktree, or commit subject claims TC0358 or the old source path.
- TC0357 is a separate return-to-following/high-water case; TC0361 is a
  keyboard handoff case. Existing N1 notification contracts are not a
  substitute for following-tail presentation continuity.
- E–H's following-list owner evidence is a current-owner bridge, not a recorded
  claim for this old Browser baseline declaration; this reservation keeps the
  old declaration's public tail-continuity obligation explicit.

## Scope and safety

This reservation is test/audit-only. The follow-up may add a public browser
successor and its audit evidence in this worktree. It must not modify product
source, vendor code, package manifests/lockfiles, fixtures, mocks, or skip
existing coverage. Private diagnostics may be used only to debug a run and may
not decide the verdict. If the public successor cannot be made meaningful on
the current product, the result will be a stable public RED with its first
user-visible boundary and owner, not a weakened assertion.

## Planned focused contract

On a fresh public Workspace session, enter the following presentation, exercise
real user-visible content growth, and verify that the active reading surface
retains the tail and keeps the appended message reachable. Repeat mode/viewport
perturbation only when it is part of the public contract; do not require an
environment-dependent number of animation frames.

Reservation status: **CLAIMED — successor and focused Chromium result pending**.
