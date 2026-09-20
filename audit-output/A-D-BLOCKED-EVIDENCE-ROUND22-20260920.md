# A–D Round 22 public-owner regression and cursor evidence (2026-09-20)

This packet continues the case-level ledger in
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md). It first
re-runs the ten ordinary red cases left by Round 21 with a narrower public
owner boundary, then covers the next ten blocked cursor cases AD-295–AD-304.
The test file is
[`tests/blocked-round22-public-owner.test.jsx`](../tests/blocked-round22-public-owner.test.jsx).

The ten priority cases remain ordinary red assertions. They are reproducible
product gaps and remain BLOCKED; no expected-fail declaration is used. The ten
cursor cases are green public-owner fixtures and are promoted to PASS.

## Focused verification

```text
npx vitest run tests/blocked-round22-public-owner.test.jsx --reporter=verbose

Test Files  1 failed (1)
Tests       10 failed | 10 passed (20)
```

Ordinary red priority cases: AD-157, AD-158, AD-167, AD-170, AD-182,
AD-284, AD-288, AD-289, AD-291, and AD-292. Green next cases: AD-295 through
AD-304.

## Case evidence

| ID | User capability | Invariant and first public owner | Current observed result |
|---|---|---|---|
| AD-157 | Old-boot cache completion cannot reappear after boot replacement. | Boot/Replica epoch admission at `ChannelFeedRuntime.enqueue` + Replica. | **RED**: c1 cache row 3 is accepted after replacement, while c1 is detached. BLOCKED capability gap. |
| AD-158 | Revoked-channel hydration cannot land in the user ledger. | Current grant set at `setHistoryGrants`/`enqueue` + Replica. | **RED**: c1 is detached but row 3 remains materialized. BLOCKED capability gap. |
| AD-167 | Revoked channel is not probed; a later grant resumes one probe. | `ChannelFeedRuntime.refreshChannel` and `channelMeta` wire port. | **RED**: refresh calls `channelMeta` while c0 is detached. BLOCKED capability gap. |
| AD-170 | Forbidden convergence removes old cached access. | `refreshChannel` access failure + Replica projection. | **RED**: history status is revoked but the cached row remains. BLOCKED capability gap. |
| AD-182 | Terminal-first history stays closed across trim and older refill. | Feed `loadHistory/pageEnd` plus Replica bounded closure. | **RED**: row 460 remains after suffix pressure. BLOCKED capability gap. |
| AD-284 | Sparse identity acknowledgement leaves an unvisited sibling unread. | `ChannelFeedRuntime.acknowledgeNotifications` currently exposes only high-water. | **RED**: boundary 3 clears all three roots; unread is 0 instead of 1. BLOCKED capability gap. |
| AD-288 | Persisted cursor facts require the active principal/world. | `prepareLocalReplica` and public `historyFor` authority projection. | **RED**: seeded high-water 999 restores at current head 40. BLOCKED capability gap. |
| AD-289 | Restored facts clamp to current ledger head. | `ChannelFeedRuntime.historyFor` cursor projection. | **RED**: high-water 999 remains above head 40. BLOCKED capability gap. |
| AD-291 | Weak all-message count remains distinct from narrower @me count. | `ChannelFeedRuntime.unreadFor` notification projection. | **RED**: unrelated conversation returns both counts as 0. BLOCKED capability gap. |
| AD-292 | Agent self-audience terminal user content can notify the user. | Feed/Replica lifecycle fold through public `unreadFor`. | **RED**: queued/processing and readable terminal all leave total 0. BLOCKED capability gap. |
| AD-295 | Earlier human incarnation is treated as the same person. | Feed self-person projection and Replica public `arrivalReceipts`. | **PASS**: old incarnation creates neither unread nor timeline arrival receipt. |
| AD-296 | Replaced terminal with no readable canonical row is not a notification. | Feed `unreadFor` joined to Replica canonical conversation. | **PASS**: replacement closure returns zero unread. |
| AD-297 | Timer activity is visible without wake transport becoming unread. | Feed public `timerFirings` and `unreadFor`. | **PASS**: canonical timer fires are visible, wake transport is quiet, readable result counts once. |
| AD-298 | Requests/finals count while provisional/unknown statuses fail closed. | Feed `unreadFor` plus Replica status projection. | **PASS**: one root is counted; queued, processing, business, missing, and unknown rows add none. |
| AD-299 | Final answer remains new content after request was read. | Feed attach baseline and public `unreadFor`. | **PASS**: head baseline 1 leaves final seq 2 unread. |
| AD-300 | Conflicting terminal does not re-notify after canonical acknowledgement. | Feed frozen notification receipt plus Replica first-terminal authority. | **PASS**: high-water 2 suppresses the conflicting seq 3 terminal. |
| AD-301 | Business-progress, missing, and unknown response statuses fail closed. | Feed public `unreadFor` classifier. | **PASS**: all three response-only rows return zero unread. |
| AD-302 | Hidden control turns never notify. | Notification policy through Feed public `unreadFor`. | **PASS**: `agent.context` request/terminal remain out of rail. |
| AD-303 | Child lifecycle frames count once under their root. | Replica canonical root projection plus Feed `unreadFor`. | **PASS**: root completion produces exactly one unread. |
| AD-304 | Rail diagnostics expose bounded decisions without message bodies/credentials. | Public `railDiagnosticSnapshot` installed by Feed runtime. | **PASS**: counts and bounded IDs/statuses are present; body and token are absent. |

## Ledger outcome

Ten cursor rows move from BLOCKED to PASS. The ten ordinary red priority rows
remain BLOCKED, not REGRESSION-closed, expected-fail, deleted, skipped, or
obsolete. The ledger is now **314 PASS / 0 REGRESSION / 51 BLOCKED**.

The remaining BLOCKED quantification is:

| Category | Count |
|---|---:|
| OWNER_MISSING | 12 |
| FIXTURE_MISSING | 24 |
| CAPABILITY_GAP | 15 |
| **Total** | **51** |

Round22 changes only the new A–D test, this evidence report, the A–D ledger,
and the two A–D verification reports. No product source, vendor, package,
lockfile, private export, or cross-owner implementation was changed.
