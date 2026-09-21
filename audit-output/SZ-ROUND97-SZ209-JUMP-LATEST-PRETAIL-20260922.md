# S–Z round 97 — SZ-209 jump-to-latest pre-tail boundary

Date: 2026-09-22

## Atomic claim

- **Case:** `SZ-209`, the S–Z numeric row for “a jump-to-latest clears
  nothing until the physical tail is actually reached”.
- **Baseline:** `fae8b70:tests/timeline-reading-integration.test.jsx:3005`
  (central migration row `TC-1380`; numeric ledger row `SZ-209`).
- **Current base:** `f8e625aaa6aa906f83bdd7c541690bf9404955e8`.
- **Branch:** `codex/sz209-current-f8e625a`.
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz209-current-f8e625a`.

This is a ledger claim only. No product source, test, package, lockfile,
vendor, private export, or compatibility path is changed by this claim.

## User contract and owner

The user may explicitly choose the latest tail while rows are still travelling
there, but the jump intent is not evidence that the user has seen the tail.
Unseen state must remain unchanged for a non-tail observation or a hidden
surface, and may clear only once the current Reading activation has a settled,
visible, hit-tested tail receipt.

The current public owner boundary is:

`useConversationProjection.viewport.jumpToLatest/requestBottom` →
`useConversationProjection.tailCaughtUp` → the existing typed arrival/Reading
receipt bridge. `VendorListExecutor` remains the sole physical DOM writer and
only supplies the settled public observation; this claim does not add another
scroll writer or acknowledgement store.

## Exact uniqueness precheck

1. The central numeric ledger contains one `SZ-209` row at
   `audit-output/SZ-NUMERIC-UNIT-MIGRATION.md:270`, and the migration ledger
   contains one corresponding `TC-1380` row at line 1731.
2. Exact searches for `SZ-209`, `TC-1380`, the source location, the title,
   branches, registered worktrees, and dedicated audit reports found no prior
   SZ-209 claim or successor. The adjacent SZ-208 durable-backlog report is a
   different “already installed tail clears all backlog” contract, not this
   pre-tail negative boundary.
3. Existing jump/latest and tail-receipt tests are adjacent evidence only;
   they do not claim the exact baseline identity above. This reservation does
   not duplicate them.

## Preserved public trajectory

The successor must retain the exact user-visible ordering:

1. Mount the current public Reading/Presentation with two unseen installed
   identities and an installed tail.
2. Invoke the public `jumpToLatest()` intent. The session may enter
   `following`, but unseen remains unchanged and no physical acknowledgement
   is emitted.
3. Deliver a current, visible-but-not-at-tail observation; it must not clear
   unseen or acknowledge the backlog.
4. Deliver an at-tail observation while the surface is hidden; it must still
   not clear unseen.
5. Deliver one current settled, visible, hit-tested at-tail receipt. Only this
   receipt may acknowledge the installed boundary, and it must do so once.

The eventual evidence must use public viewport/session output and the existing
typed receipt port. It must not inspect refs, private queues, raw IDB rows, a
diagnostic-only event, a timer, or a test-only oracle.

## Scope after reservation

The eventual packet is limited to the current Reading/Presentation owner and
its focused public contract. If the current owner fails, record the first
public boundary and hand off the regression; do not compensate in Vendor,
create a second store/writer, weaken the tail/visibility fence, or restore the
retired `useReadingSession` implementation.

## Public-owner closeout

The migrated public contract is covered by
`tests/sz209-jump-latest-pre-tail-public-owner.test.jsx`. It seeds the public
View Session durable unseen records, mounts the current Presentation rows,
registers the physical root through `viewport.onReadingRootActivation`, and
drives only `viewport.jumpToLatest` and `viewport.onReadingObservation`.

The test proves the complete user-visible boundary without private refs,
diagnostic events, raw storage rows, timers, or a second writer:

1. `jumpToLatest()` enters `following` but leaves both durable unseen
   identities pending.
2. A current settled non-tail paint leaves both identities pending.
3. A hidden at-tail sample is rejected as authority and leaves both pending.
4. One current visible, settled, hit-tested tail receipt clears the durable
   scope and reports `tailCaughtUp` at boundary 4/physical sequence 4.

Focused result on the claimed base: the SZ-209 file (1 test), SZ-208
installed-tail positive contract (1 test), and SZ-169 exact-row negative
contract (1 test) pass together. The adjacent SZ-205 live-arrival overflow
contract also passes when run independently with its established 15-second
test budget. `npm run build` passes with only the repository's existing large
chunk warning. No product source was needed; the existing
`useConversationProjection` Reading owner and `VendorListExecutor` sole
physical writer already satisfy the boundary.
