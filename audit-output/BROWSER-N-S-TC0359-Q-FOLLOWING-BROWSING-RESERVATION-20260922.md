# Browser N–S reservation: TC0359 / repeated following–browsing handoff

Date: 2026-09-22  
Reviewer: Browser N–S independent reviewer  
Baseline: `fae8b70:tests/browser/q-following-tail-frames.spec.js:440`  
Current base: `b71eb75`

## Claim

I reserve TC0359, the next unclaimed Browser N–S baseline after TC0358: ten
real user handoffs from following to browsing and back must preserve the
committed reading surface, avoid a blank frame, and return to the physical
tail. The successor will use only public DOM, scroll geometry, mode, focus, and
rendered message reachability. It will not retain the old private scroll-write
interceptor, frame sampler globals, or implementation-specific dual-list names.

## De-duplication performed before reservation

- The central ledger is the only repository hit for TC0359 and the old
  `q-following-tail-frames.spec.js` source.
- No other `audit-output` report names TC0359 or the old source path; current
  E–H following-list evidence is an owner bridge, not a claim for this browser
  declaration.
- No ref, worktree, or commit subject claims TC0359.
- TC0358 is the separate following-tail content-growth contract and is already
  delivered as `c1ca28a`; it does not cover repeated mode handoffs.
- TC0357 covers a distinct tail re-entry/high-water path. T–Z's browsing-up
  Waiting case covers queued-task/channel-exit behavior, not ten repeated
  following↔browsing public handoffs. Existing N-S F7 covers cross-channel
  session identity, not this repeated same-channel handoff contract.
- TC0227–TC0230, including TC0228, were excluded because E–H R38 and the
  central ledger already cover them.

## Scope and safety

This reservation is test/audit-only. The successor may add a public browser
spec and audit evidence in this detached worktree. It must not modify product
source, vendor code, package manifests/lockfiles, fixtures, mocks, or skip
coverage. Private diagnostics may help investigate a run but may not determine
the verdict. A public failure will remain a stable RED with its first
user-visible boundary and owner; no assertion will be weakened to obtain green.

## Planned focused contract

On a fresh public Workspace session with enough rendered tail content for a
real browsing move, perform ten ordinary upward-wheel/downward-wheel cycles.
Each cycle must publish browsing with the same committed surface and no empty
visible owner, then publish following at the physical tail with the prior
message set reachable and focus retained. The oracle will tolerate only the
existing public tail geometry bound and will not require an environment-specific
frame count.

Reservation status: **CLAIMED — successor and focused Chromium result pending**.
