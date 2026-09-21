# Browser T–Z reservation — TC0357 / wheel return to following

## Atomic claim

- **Canonical baseline key:** `TC0357`
- **Baseline identity:** `fae8b70:tests/browser/q-diag-return.spec.js:12`
- **Reservation state:** `RESERVED — not PASS, not credit, not a product fix`
- **Reservation base:** `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`
- **Reservation worktree:** `/tmp/atoll-web-tc0357-claim-73413e2` (detached)

This reservation covers the distinct public journey in which a reader leaves
the tail, then uses ordinary wheel-down input to return to the live tail. The
current public surface must converge to `following` at the tail and keep the
newest content visible. A later packet may be credited only after running the
current public path from this exact base in real Chromium.

## Uniqueness and exclusions

- No `TC0357` successor, reservation, branch, or worktree was found in the
  current refs/worktree registry before this reservation.
- TC0259 covers explicit jump-latest writer/intersection behavior; existing
  live-tail tests cover append while already following. Neither covers this
  wheel-down return journey.
- Space, SZ189, SZ212, and SZ215 domains are outside this reservation.

## Current public owner and scope

The current owner is the existing Timeline/Reading active list and its public
viewport-mode projection. The successor will use real wheel input, visible
DOM rows, and the public `following` result only. It will not add a scroll
writer, private diagnostics oracle, fixture shortcut, product/vendor/protocol
change, or weakened assertion.

