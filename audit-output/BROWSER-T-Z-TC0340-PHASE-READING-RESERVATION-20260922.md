# Browser T–Z reservation — TC0340 / Reading reverse-entry paint

## Atomic claim

- **Canonical baseline key:** `TC0340`
- **Baseline identity:** `fae8b70:tests/browser/post-entry-upward-jump-stage2.spec.js:215`
- **Reservation state:** `RESERVED — not PASS, not credit, not a product fix`
- **Reservation base:** `390fa3af9cc7e34c15f1e7e2b9197843376c6021`
- **Reservation worktree:** `/tmp/atoll-web-tc0340-claim-390fa3a` (detached)

This reservation covers only the public user journey in which a cold or
same-session channel entry is followed by a real upward wheel. It must prove
that the user enters browsing and that the first visible reverse-history result
is painted without a blank or stale entry surface. A later packet may be
credited only after the current public path is run from this exact base.

## Uniqueness and scope

- No `TC0340` successor, reservation, branch, or worktree was present in the
  current refs/worktree registry before this reservation.
- TC0300 is separately claimed in another detached worktree and is not reused.
- TC0331/TC0332 and TC0334–TC0339 are separate template, governance, file, and
  shell claims; they are not folded into this Reading contract.
- Waiting, Space, and SZ212 contracts are outside this reservation.

## Current public owner and contract

The current owner is the existing Reading surface rendered by
`TimelineFeature`/`useReadingSession` and its canonical active reading layer.
The successor must use public DOM state and visible rows only. It must not add
diagnostic probes, a second scroll writer, a private state oracle, a fixture
shortcut, or a product/source change.

