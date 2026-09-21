# S–Z round 98 — SZ-218 real-presence fallback fence

Date: 2026-09-22

## Atomic claim

- **Case:** `SZ-218`, the S–Z numeric row for suppressing the fallback only
  when the user is really present: browsing, hidden Surface, and hidden page
  do not count as presence.
- **Baseline:** `fae8b70:tests/timeline-reading-integration.test.jsx:3249`
  (central migration row `TC-1389`).
- **Current base:** `8c2939e350bc554d02f606cb4df9347ec3b89d76`.
- **Branch:** `codex/sz218-current-8c2939e`
- **Worktree:**
  `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz218-current-8c2939e`.

This is a test/audit-only claim. It does not change product source, package,
vendor, protocol, private exports, or compatibility paths.

## Exact uniqueness and SZ-210 separation

1. The central numeric ledger has one `SZ-218` row at
   `audit-output/SZ-NUMERIC-UNIT-MIGRATION.md:279`; the migration ledger has
   one corresponding `TC-1389` row at line 1740.
2. Searches across branches, worktrees, audit reports, tests, and commit
   subjects found no prior SZ-218 claim or successor. The old round-24 table
   only records an unimplemented handoff, not a claim or implementation.
3. SZ-210 owns the installed-high-water receipt path and its source/test
   files. This claim only adds a new public-owner test and this report, so it
   has no shared SZ-210 hunk or source-file conflict.

## Public owner and invariant

The current public owner is `useConversationProjection.viewport`, which
combines Reading mode, the existing typed tail receipt, and the shared
document/Surface visibility boundary. `VendorListExecutor` remains the sole
physical writer; this claim does not add a scroll command, receipt store, or
fallback owner.

The public contract is:

1. A pending live arrival may make the tail receipt necessary, but browsing
   is not presence and does not suppress the pending notice.
2. A Surface-hidden tail sample is not presence and cannot acknowledge the
   arrival.
3. A document-hidden tail sample is not presence and cannot acknowledge the
   arrival.
4. Only a current visible, settled, hit-tested tail sample may become
   `tailCaughtUp` and consume the pending receipt.

The test observes only the public viewport/session and typed `arrivalReceipts`
port. It does not inspect refs, scheduler queues, diagnostic events, private
storage rows, or internal React state.

## Scope

This packet migrates the exact three-gate negative contract to the current
Reading owner. If it fails, the first public boundary is reported; no product
patch, second Reading state owner, or geometry writer is introduced.

## Verification

The focused SZ-218 test passes. The adjacent SZ-208 installed-tail positive
contract and SZ-169 exact-row negative contract pass together with it (3 files,
3 tests). `npm run build` passes with only the repository's existing large
chunk warning. No SZ-210 source or test file is changed.
