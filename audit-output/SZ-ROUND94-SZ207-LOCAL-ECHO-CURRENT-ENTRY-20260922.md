# SZ-207 — local echo requires a current durable physical tail

Date: 2026-09-22

## Claim and owner

- Baseline: `SZ-207`, the retained migration case whose user capability is
  that a locally echoed `human.message` may become the current-entry
  presentation only after the current durable tail covers the authoritative
  head.
- Current public owner: `useConversationProjection` → Reading viewport
  `presentationAuthority`. The test observes the public Presentation rows,
  `viewport.status.headSeq`, and the four-field authority receipt; it does not
  import or call the old `currentEntryAuthority` helper.
- Current base: `4fe8add95a75ce7a9cc70384aa16a57e8c88f376`.
- Unique check: no current branch, worktree, SZ audit, or successor test claims
  SZ-207. SZ-206 covers incomplete history-tail signing for a durable
  candidate, while SZ-207 is the distinct local-echo promotion boundary.

## Contract

The current presentation can contain the local echo before the durable history
has reached the current head, but the echo must not receive current-entry
authority in that gap. With `headSeq=9` and durable coverage ending at `8`,
`viewport.presentationAuthority` remains `null`. Once the same current
generation covers `1..9`, the public receipt is issued for the local echo and
contains only the canonical `{ epoch, viewID, sourceRevision, candidateID }`
fields.

The case uses `human.message` because `agent.ask` is a Waiting-layer submission
and is intentionally excluded from Timeline Presentation; mixing those two
paths would test a different owner and overclaim this baseline.

## Evidence

Test: `tests/sz207-local-echo-current-entry-public-owner.test.jsx`

- The public Presentation contains both durable row `durable-8` and local echo
  `local-echo` in the first state.
- The incomplete durable coverage (`1..8`) produces no authority receipt.
- Replacing only the public history status with coverage through authoritative
  head `9` produces the frozen receipt for `local-echo`.

Focused Vitest: PASS (1 test). Product/source files are unchanged; no vendor,
package, lockfile, skip, compatibility path, private export, or second owner
was added.
