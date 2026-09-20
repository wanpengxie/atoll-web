# A–D unit migration verification (2026-09-20)

Scope is the top-level `tests/` A–D partition from baseline `fae8b70`: 42
suites and 365 declarations. The complete case ledger remains
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md), with one
row per baseline declaration and the current result, public owner, invariant,
and disposition. After the P0 batch and the first P1 composed-interaction
fixture batch plus the follow-up Waiting-owner regression packet, the AD-103
Workspace owner fix, and the AD-123 artifact owner fix, accepted case totals
plus the AD-011 and AD-143 owner closures are **260 PASS / 0 REGRESSION /
105 BLOCKED**. Round 15 then recovered six independently verifiable terminal
contracts, leaving **266 PASS / 0 REGRESSION / 99 BLOCKED**.

Round 16 recovered 17 additional blocked IDs through current public Waiting,
probe, presentation, and Composer owners, leaving **283 PASS / 0 REGRESSION /
82 BLOCKED**. AD-002–004 were rechecked at the existing Activity/Operation
boundary and remain explicit product-gap evidence.

Round 18 selected 20 rows from that remainder while avoiding flat/cache,
Reading, and Composer conflict surfaces. The current WorkspaceLayout handoff
gate closed AD-096 and AD-098; the current ChannelAdministrationPanel closed
the submit/ledger-failure retry contract AD-154 and standard/foundation actor
filtering AD-191. The subsequent shell owner `3d1c061` also closed AD-101's
mobile message-surface fact. The other 15 rows remain explicit expected-fail
evidence for missing dialog/convergence/rollback owners. The current ledger is
therefore **288 PASS / 0 REGRESSION / 77 BLOCKED**.

Round 20 adds the next 20 previously-uncovered blocked rows through the public
Waiting and ChannelFeedRuntime boundaries. AD-163, AD-168, AD-169, AD-171,
AD-172, and AD-173 now have green public evidence; AD-027, AD-037,
AD-156–AD-161, AD-165–AD-167, AD-170, AD-178, and AD-182 remain explicit
expected-fail evidence. The current ledger is **294 PASS / 0 REGRESSION /
71 BLOCKED**.

Round 21 adds the five priority Feed/Replica regression reproductions
AD-157/158/167/170/182 as ordinary red assertions, plus public-owner cursor
evidence for AD-277/278 and AD-282–AD-294. Ten cursor cases pass; the five
cursor capability gaps AD-284/288/289/291/292 and all five priority Feed gaps
remain BLOCKED. The independent packet is
[`tests/blocked-round21-public-owner.test.jsx`](../tests/blocked-round21-public-owner.test.jsx),
with its case-level report in
[`A-D-BLOCKED-EVIDENCE-ROUND21-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND21-20260920.md).
Unlike earlier expected-fail packets, the ten unresolved cases are ordinary
red assertions and therefore cannot be mistaken for recovery. The ledger is
now **304 PASS / 0 REGRESSION / 61 BLOCKED**.

The P0 batch recovered AD-057/058, AD-125–127, and AD-138–141 through
`useAgentProbes`, `useIdentitySession`, and the public Describe projection.
AD-316 remains an explicit blocked red reproduction: the current
`SpaceDevices` owner submits a device command but does not request an
authoritative refresh after terminal.

The first P1 composed-interaction batch now passes AD-014 and AD-017 through
the Waiting composition: the timeline edit action stays out of the Composer
until the target's matching queued+resumed fact, and an overlaid edit hold
restores the underlying interrupt pause after release/expiry. No feed runtime
or product code outside the Waiting/edit owner was changed.

The follow-up Waiting-owner packet also passes AD-018 and AD-021: compact
unhold closures no longer clear a hold without authoritative release facts, and
the held target's second core `processing` transition after matching
`queued+resumed` clears the hold without mistaking unrelated `tool.started`
business progress for queue advancement.

The same-owner follow-up closes AD-022 and AD-031: cache-only queued controls
stay hidden until the control tail is current, and a cancelled edit target
closes its Composer session with an exact-hold release.

The next same-owner pair closes AD-032 and AD-038 independently: a newer
interrupt ends editing without stale unhold, while save follows the latest
committed callback/turn and release remains with the original hold owner.

The next Waiting/timeline presentation fix closes AD-041: an interrupted
terminal stays on the stopped Agent bubble with the resumable user action and
does not render as an ordinary failure or Waiting hold pause.

The next public parameter-owner fix closes AD-062: after the live context
probe, later same-Agent ask terminals refresh the usage projection while a
sparse terminal leaves the last complete reading intact.

The next Workspace owner fix closes AD-103: a user channel selection records
its target and origin, then the committed `activeChannelId` handoff focuses the
target heading with `preventScroll`; a superseded request cannot focus a later
channel. The public fixture uses `WorkspaceLayout`/`WorkspaceRail` and does not
focus until the target identity is committed.

The next artifact owner fix closes AD-123: the `ChannelReplica` public
Presentation feeds `feature-search` explicit attachment facts, preserving the
same-channel relation key for `version_of` and merging repeated references by
resource ID. Missing relations remain absent, and filenames never create a
link. The fixture stays on the public projected artifact rows.

The final two owner closures are independently green. AD-011 now lets a
same-boot history terminal settle retained live work and clears that state on a
boot change; history-only processing remains invisible. AD-143 now filters
actor/lobby implementation profiles from the public access rows while keeping
the member write and public discoverable facts distinct. These behaviors come
from existing owner commits `e09169e` and `6c880aa`; this verification only
drives their public contracts.

## Round 15 blocked-evidence recovery

This round selected 20 previously `BLOCKED` cases by user capability, current
public owner, old action, and current result. It added one-to-one public tests
for AD-002–004 (Activity/Operation), AD-093–108 except AD-103 (terminal/channel
handoff), and AD-202–203 (node update). The Activity cases preserve the public
`feature-search` boundary and reproduce the missing Operation projection. The
node-update cases preserve the public `WorkspaceLayout` boundary and reproduce
the absence of a node-update owner. Neither gap was changed in this round.

Six terminal contracts were green in the original Round 15 packet through the
public `WorkspaceLayout` plus `WorkspaceFeatures` composition: AD-094, AD-095,
AD-100, AD-102, AD-104, and AD-107. The then-red cases remain explicit
`BLOCKED` packets with preserved `it.fails` reproductions: AD-002–004, AD-093,
AD-096–099, AD-105–106, AD-108, and AD-202–203. AD-096/098 were subsequently
closed by the shell handoff owner, and AD-101 by owner `3d1c061`; these are not
judged obsolete, deleted, skipped, or merged—the remaining red results are
returned to their first public owner boundaries.

## Round 16 blocked-evidence recovery

Round 16 selected exactly 20 rows from the 99-row blocked remainder: the
existing AD-002–004 Activity/Operation reproductions were re-run at the public
`feature-search` boundary, and 17 non-shell/node/restart rows were exercised
through current public owners. The Activity rows remain explicit product-gap
packets because `selectFeatureSearchIndex` still emits no Operation row; no
task/artifact owner was substituted for that capability.

The new public-owner fixture is
`tests/blocked-round16-public-owner.test.jsx`. It closes AD-034 and AD-039
through `useWaitingEditingController`, AD-074 through `useAgentProbes`,
AD-327–329/333/335–338/340–343 through `TimelineRowRenderer` and
`ChannelReplica`/`ConversationPresentation`, and AD-350–351 through the public
Composer model/rendering owner. AD-327 is one baseline `it.each` declaration
with two green variants, so the focused command reports 18 green executions for
17 promoted IDs. The combined result is **2 files passed; 18 passed, 3
expected-fail (21)**. The three expected-fail Activity assertions are evidence
only; they do not count as recovered cases.

The ledger after this round is **283 PASS / 0 REGRESSION / 82 BLOCKED**. No
baseline declaration was deleted, skipped, or marked obsolete.

## Round 18 blocked-evidence recovery

Round 18 selected exactly 20 rows from the 82-row blocked remainder, limited
to the public target-handoff and governance/permission/failure boundaries:
AD-096–099, AD-101, AD-105–106, AD-108, AD-149–155, and AD-191–195. The
fixture is [`tests/blocked-round18-public-owner.test.jsx`](../tests/blocked-round18-public-owner.test.jsx).

The focused result is **1 file passed; 5 passed, 15 expected-fail (20)**. The
green IDs are AD-096 and AD-098 through `WorkspaceLayout`, AD-101 through the
new mobile-surface publication, AD-154 through the public
`ChannelAdministrationPanel` draft/failure/retry port, and AD-191 through its
roster/declaration filtering. The 15 expected-fail assertions are evidence
only: AD-097/099/105/106/108 still lack the requested target rollback or
per-channel terminal owner, while AD-149–153, AD-155, and AD-192–195 still
lack the independent create-dialog or full ledger/OBS/membership/serving
convergence owner. They remain BLOCKED and are not counted as recovered cases.

## Round 19 blocked-evidence recovery

Round 19 adds an independent 20-case public-owner packet selected from the
78-row remainder at round start (the concurrent AD-101 owner closure leaves
77 current blocked rows) at
[`tests/blocked-round19-public-owner.test.jsx`](../tests/blocked-round19-public-owner.test.jsx),
limited to the current governance, permission/control, and navigation
boundaries. Search, Reading, cache/startup, and Activity/Operation owner gaps
are out of scope. The packet rechecks six unresolved navigation rows, six
create-dialog rows, six governance-convergence rows, and two principal-scoped
control-recovery rows. Each assertion records the user capability, invariant,
public owner, and observed result; expected-fail is evidence only and does not
alter the ledger.

The focused result is **1 file passed; 1 passed, 19 expected-fail (20)**. AD-101
is green through the already landed mobile-surface owner; the remaining 19
rows stay BLOCKED at their current public owner boundaries. The current ledger
after this packet is **288 PASS / 0 REGRESSION / 77 BLOCKED**.

No source, package, lockfile, flat/cache, Reading, Composer, or private export
was changed by this round.

## Round 20 blocked-evidence recovery

Round 20 selected the next 20 previously-uncovered rows: AD-027, AD-037,
AD-156–AD-161, AD-163, AD-165–AD-173, AD-178, and AD-182. The independent
public-owner fixture is
[`tests/blocked-round20-public-owner.test.jsx`](../tests/blocked-round20-public-owner.test.jsx).
It drives Waiting through `useWaitingEditingController`/`WaitingLayer` and
startup through `ChannelFeedRuntime`/`ChannelReplica`; it does not import a
retired fold/store or export a private helper.

Focused result:

```text
npx vitest run tests/blocked-round20-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       6 passed | 14 expected fail (20)
```

AD-163, AD-168, AD-169, AD-171, AD-172, and AD-173 are promoted to PASS in
the ledger. AD-027, AD-037, AD-156–AD-161, AD-165–AD-167, AD-170, AD-178,
and AD-182 remain BLOCKED. Expected-fail assertions are unresolved evidence,
not completion, deletion, skip, or an obsolete-case decision. Product gaps
are handed back at the first public boundary; no Feed, Reading, Workspace,
vendor, package, lockfile, or product source was changed in this packet.

The ledger after Round 20 is **294 PASS / 0 REGRESSION / 71 BLOCKED**.

## Round 21 public-owner regression and cursor evidence

Round 21 selected AD-157/158/167/170/182 as the priority Feed/Replica
regression package and AD-277/278/282–AD-294 as the next cursor cases. The
new tests use only the public `ChannelFeedRuntime` snapshot and
`ChannelReplica.arrivalReceipts` ports. They do not import the deleted
`src/model/cursors.js`, inspect private production fields, or modify product
code.

Focused result:

```text
npx vitest run tests/blocked-round21-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests       10 failed | 10 passed (20)
```

PASS rows are AD-277, AD-278, AD-282, AD-283, AD-285, AD-286, AD-287,
AD-290, AD-293, and AD-294. Ordinary red rows are AD-157, AD-158, AD-167,
AD-170, AD-182, AD-284, AD-288, AD-289, AD-291, and AD-292. The red rows
remain BLOCKED at their first public owner; they are not converted to
`it.fails`, deleted, skipped, or declared obsolete. The ledger after this
round is **304 PASS / 0 REGRESSION / 61 BLOCKED**.

Round 22 re-runs those ten red public-owner cases with narrower setup/result
proof and covers the next ten cursor rows AD-295–AD-304. The independent
packet is [`tests/blocked-round22-public-owner.test.jsx`](../tests/blocked-round22-public-owner.test.jsx),
with its case-level report in
[`A-D-BLOCKED-EVIDENCE-ROUND22-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND22-20260920.md).
The focused result is **10 passed / 10 ordinary red (20 total)**. AD-295–304
move to PASS; the ten priority product gaps remain BLOCKED. The ledger is now
**314 PASS / 0 REGRESSION / 51 BLOCKED**.

Round 23 selects twenty remaining BLOCKED rows with current public
Activity, Workspace, and Governance owners: AD-002/003/004,
AD-093/097/099/105/106/108, AD-149/150/151/152/153/155, and
AD-192/193/194/195/196. The independent packet is
[`tests/blocked-round23-public-owner.test.jsx`](../tests/blocked-round23-public-owner.test.jsx),
with its case-level report in
[`A-D-BLOCKED-EVIDENCE-ROUND23-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND23-20260920.md).
The focused result is **20 ordinary red (20 total)**. All twenty remain
BLOCKED; no expected-fail result is counted as completion. The ledger remains
**314 PASS / 0 REGRESSION / 51 BLOCKED**.

Round 24 adds [`tests/blocked-round24-public-owner.test.jsx`](../tests/blocked-round24-public-owner.test.jsx)
and its case-level report [`A-D-BLOCKED-EVIDENCE-ROUND24-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND24-20260920.md).
The focused result is **1 passed / 19 ordinary red (20 total)**. AD-167 is
promoted after independently verifying the existing Feed refresh admission fix;
the other nineteen rows remain BLOCKED. The current ledger is **315 PASS / 0
REGRESSION / 50 BLOCKED**, with OWNER_MISSING 12, FIXTURE_MISSING 24, and
CAPABILITY_GAP 14. No ordinary red result is counted as completion.

Round 25 adds [`tests/blocked-round25-public-owner.test.jsx`](../tests/blocked-round25-public-owner.test.jsx)
and its case-level report [`A-D-BLOCKED-EVIDENCE-ROUND25-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND25-20260920.md).
It independently re-verifies AD-157/158/167 through the Feed public owner and
also catches the already-landed cursor clamp owner for AD-288/289. The focused
result is **5 passed / 15 ordinary red (20 total)**. AD-157, AD-158, AD-288,
and AD-289 move from BLOCKED to PASS; AD-167 remains PASS. AD-170, AD-182,
AD-284, AD-291, AD-292, AD-002/003/004, AD-093/097/099/105/106/108, and
AD-149 remain ordinary red BLOCKED evidence. The current ledger is **319 PASS /
0 REGRESSION / 46 BLOCKED**, with OWNER_MISSING 12, FIXTURE_MISSING 24, and
CAPABILITY_GAP 10. No ordinary red result is counted as completion.

Round 26 adds [`tests/blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx)
and its case-level report [`A-D-BLOCKED-EVIDENCE-ROUND26-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND26-20260920.md).
After excluding the closed AD-157/158/167/288/289 rows, it records the next
twenty current BLOCKED rows: AD-027/037, AD-150–153/155, AD-156/159–161,
AD-165/166/178, and AD-192–197. The focused result is **20 ordinary red (20
total)**. No row is promoted, deleted, skipped, or converted to expected-fail
semantics; the ledger remains **319 PASS / 0 REGRESSION / 46 BLOCKED**, with
OWNER_MISSING 12, FIXTURE_MISSING 24, and CAPABILITY_GAP 10.

Round 27 adds [`tests/blocked-round27-fixture-recovery.test.jsx`](../tests/blocked-round27-fixture-recovery.test.jsx)
and its case-level report [`A-D-BLOCKED-EVIDENCE-ROUND27-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND27-20260920.md).
It rechecks all twenty Round 26 rows without adding another ordinary-red
declaration. AD-027, AD-178, and AD-196 now have faithful current public
fixtures: the Waiting/Reading handoff uses the matching queued+resumed fact,
the Feed cache fixture names the same boot on both attaches, and the Governance
failure fixture selects the public 概览 tab before submitting. The focused
result is **1 file passed / 3 passed / 0 failed**. The remaining ten rows with
named owners are classified as direct capability gaps (AD-037, AD-156,
AD-159–161, AD-192–195, AD-197); AD-150–153, AD-155, AD-165, and AD-166 remain
without a current public owner. The ledger is now **322 PASS / 0 REGRESSION /
43 BLOCKED**, with OWNER_MISSING 12, FIXTURE_MISSING 11, and CAPABILITY_GAP 20.
No product source or baseline declaration changed.

Round 29 adds the case-level packet
[`A-D-BLOCKED-EVIDENCE-ROUND29-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND29-20260920.md)
for ten current-owner capability gaps: AD-170, AD-182, AD-202, AD-203,
AD-256, AD-257, AD-284, AD-291, AD-292, and AD-316. It intentionally adds no
duplicate ordinary-red test declarations; the existing Round 24/25 public-owner
assertions are the executable regression sources. The focused selection is
**2 files failed; 10 selected tests failed; 30 tests skipped**. The ten red
results remain BLOCKED and no row is promoted. The ledger remains **322 PASS /
0 REGRESSION / 43 BLOCKED**, with OWNER_MISSING **10**, FIXTURE_MISSING **10**,
and CAPABILITY_GAP **23** after identifying the public owner boundaries for
AD-256/257 and AD-316. No capability is declared obsolete.

Round 30 adds [`tests/blocked-round30-fixture-recovery.test.jsx`](../tests/blocked-round30-fixture-recovery.test.jsx)
and its case-level packet
[`A-D-BLOCKED-EVIDENCE-ROUND30-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND30-20260920.md).
The new public Feed/Replica fixture is **1 file passed; 2 tests passed; 0
failed**, promoting AD-306/307 from `FIXTURE_MISSING` to PASS. The existing
Round 24/25 assertions for AD-093/097/099/105/106/108/331/334 were selected
without adding duplicate red tests: **2 files failed; 8 selected tests failed;
32 tests skipped**. Those eight ordinary-red results remain BLOCKED and are
classified as direct `CAPABILITY_GAP` at their WorkspaceLayout or
ConversationPresentation/Composer owners. The ledger is now **324 PASS / 0
REGRESSION / 41 BLOCKED**, with OWNER_MISSING **10**, FIXTURE_MISSING **0**,
and CAPABILITY_GAP **31**. No capability is declared obsolete and no product
source changed.

Round 31 adds the case-level packet
[`A-D-BLOCKED-EVIDENCE-ROUND31-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND31-20260920.md)
for ten existing capability-gap rows with public Waiting, Feed/Replica, and
Governance owners: AD-037, AD-156, AD-159–AD-161, and AD-192–AD-195/AD-197.
It deliberately adds no red test declaration. The unique Round 24 selection
for six rows is **1 file failed; 6 failed; 14 skipped**; the unique Round 26
selection for four rows is **1 file failed; 4 failed; 16 skipped**. No selected
assertion recovers to PASS; all ten remain ordinary-red capability evidence.
The ledger and categories remain **324 PASS / 0 REGRESSION / 41 BLOCKED** with
OWNER_MISSING 10, FIXTURE_MISSING 0, and CAPABILITY_GAP 31. No product source
or baseline declaration changed.

Round 32 adds the case-level packet
[`A-D-BLOCKED-EVIDENCE-ROUND32-20260920.md`](./A-D-BLOCKED-EVIDENCE-ROUND32-20260920.md)
for ten non-Governance capability-gap rows with existing WorkspaceLayout,
Feed/Replica, and Composer public owners: AD-093/097/099/105/106/108,
AD-170/182, and AD-256/257. It adds no duplicate red declaration; the unique
Round 24/25 assertions report **2 files failed; 10 selected tests failed; 30
tests skipped**. No selected row recovers to PASS, so these remain ordinary-red
capability evidence and the ledger remains **324 PASS / 0 REGRESSION / 41
BLOCKED** with OWNER_MISSING 10, FIXTURE_MISSING 0, and CAPABILITY_GAP 31.
Governance is deferred pending the new owner candidate; no product source or
baseline declaration changed.

## Round 35 Governance owner candidate and next unique baseline

Round 35 migrates the previously blocked AD-149 declaration to the current
public entry `WorkspaceRightPanel` → `GovernanceFeature.ChannelCreateModal`.
The case still protects the user's ability to open a real create dialog, focus
the name field, and submit a channel-create command; the test no longer
asserts the deleted `src/ui/ChannelCreateModal.jsx` implementation. Its
focused result is **1 file passed; 1 test passed**:

```text
npx vitest run tests/channel-create-modal.test.jsx --reporter=dot
```

The same owner candidate now consumes an explicit `port.creation` projection
keyed by the returned request id. `accepted`, `ledger`, `observable`,
`membership`, and `serving` are all false unless supplied as typed facts; a
same-name directory child or command receipt cannot declare ready. Entry uses
the optional Shell `commands.enterChannel` port and stays disabled with a
contract message when that port is absent; the feature does not write
`globalThis.location.hash`. At the Round 35 frozen head the mounted Workspace
port supplied neither fact, so AD-153 remained **BLOCKED** at that time. Round
37 independently verifies the current public owner and records the later
typed Shell projection as PASS; the historical Round 35 evidence is retained
as the original first-owner handoff.

The Round 35 ledger was **325 PASS / 0 REGRESSION / 40 BLOCKED**. After the
unique AD-153 public-owner migration in Round 37, the ledger is **326 PASS / 0
REGRESSION / 39 BLOCKED**. AD-150–152 and AD-155 remain individually
unresolved Governance contracts; no ordinary-red duplicate was added for
them. Focused AD-153 verification is **1 file passed; 2 tests passed**
(`tests/channel-create-modal.test.jsx`), and browser TC-0192 is **1 passed**.

## Round 38 — Shell clean Activity candidate and Governance failure/retry

At clean Shell candidate `3847f8f`, strict Chromium re-verification of
TC-0193/0194/0195 is **3 passed**. TC-0194 now has a canonical channel-create
Operation projection and returns through the typed turn source; TC-0193's
WorkItem source and TC-0195's access-revocation/cache assertions remain green.
The AD-153 unit contract remains green (**2 passed**) and TC-0192 remains green
(**1 passed**).

The independent Governance failure/retry contract for AD-154 is **RED**:
matching `creation.failed=true,error='名称已存在'` reaches the public modal and
shows the terminal error, but the progress header remains `正在收敛`, the action
remains `创建频道`, and no `重新创建` control is exposed. This is a real
current-owner product gap, not a selector or fixture issue. The ledger is
therefore **325 PASS / 1 REGRESSION / 39 BLOCKED**; AD-154 is not counted as
PASS and no expected-fail result is used.

## Round 39 — exact clean HEAD AD-154 re-verification

The exact clean candidate is `15e4470`. The focused Governance owner contract
for AD-154 now passes **3/3** (`tests/blocked-round35-governance-public-owner.test.jsx`):
submit rejection remains observable and retryable, a matching failed ledger
terminal renders `创建失败`, preserves the draft, exposes `重新创建`, and does
not expose entry; the adjacent same-name and typed Shell contracts remain
green. The AD-153 focused unit slice is also **2/2 passed**.

The Round 38 regression packet is closed by the already-landed Governance
owner fix `34f286b`; this round changed no product code. AD-154 returns to PASS,
so the current ledger is **326 PASS / 0 REGRESSION / 39 BLOCKED**. No capability
was declared obsolete, no expected-fail was counted, and no baseline was
deleted or skipped.

## Round 40 — public-owner recovery batch

Round 40 re-runs the next ten still-BLOCKED public-owner contracts: AD-170,
AD-182, AD-284, AD-291, AD-292, AD-316, AD-331, AD-334, AD-363, and AD-364.
The focused existing assertions report **1 passed / 9 ordinary red / 30
focused-out skips** across the two source files. AD-316 now passes through the
current public `SpaceAdministrationPanel → SpaceDevices` command port: terminal
`create_device` calls the injected `refresh('devices')` exactly once. The nine
other rows remain ordinary-red Feed/notification, ConversationPresentation, or
Composer capability-gap evidence; none is counted as expected-fail completion.

The current ledger is therefore **327 PASS / 0 REGRESSION / 38 BLOCKED**. The
case-level records are in
[`A-D-ROUND40-PUBLIC-OWNER-RECOVERY-20260920.md`](./A-D-ROUND40-PUBLIC-OWNER-RECOVERY-20260920.md).
No product source, private export, compatibility API, baseline declaration,
skip, or expected-fail semantic changed in this round.

## Round 41 — AD-097 public-owner fixture recovery

At latest clean `c777ef2`, the existing public `WorkspaceLayout` contract for
AD-097 is green: both the Round18 owner contract and the migrated Round25
fixture pass (**2/2 passed; 38 focused-out skips**). The current behavior is
that reselecting already-committed `c0` cancels the presentation pending gate,
re-enables the committed terminal entry, and does not replay c0's canonical
navigation side effect. The former Round25 `['c1', 'c0']` expectation was a
stale fixture oracle, not a missing product capability.

AD-097 is promoted to PASS, so the current ledger is **328 PASS / 0
REGRESSION / 37 BLOCKED**. The case-level record is in
[`A-D-ROUND41-AD097-FIXTURE-RECOVERY-20260920.md`](./A-D-ROUND41-AD097-FIXTURE-RECOVERY-20260920.md).
Only the A-D test fixture and audit files changed; no product source or
private/compatibility API was touched.

## Round 42 — AD-105 public-owner fixture recovery

At latest clean product HEAD `ff6efd2`, the existing public `WorkspaceLayout`
contract for AD-105 is green in both its Round18 owner declaration and the
migrated Round25 fixture (**2/2 passed; 38 focused-out skips**). Rapid A→B→A
selection now has one canonical `c1` navigation call: reselecting the already
committed `c0` cancels the stale presentation gate, does not replay c0's
canonical navigation side effect, and re-enables the public terminal entry.
The former Round25 `['c1', 'c0']` expectation was a stale fixture side-effect
oracle, matching the already-green AD-097 public contract.

AD-105 is promoted to PASS, so the current ledger is **329 PASS / 0
REGRESSION / 36 BLOCKED**. The case-level record is in
[`A-D-ROUND42-AD105-FIXTURE-RECOVERY-20260920.md`](./A-D-ROUND42-AD105-FIXTURE-RECOVERY-20260920.md).
Only the A-D test fixture and audit files changed; no product source,
private/compatibility API, or cross-owner behavior was touched.

## Round 43 — AD-093 public Reading-entry gap

At latest `0ba7fa7`, the ordinary public `WorkspaceLayout` reproduction for
AD-093 still returns no accessible `打开最近阅读` button (**1 failed; 19
focused-out skips**). The first public divergence is the shell/Reading-entry
composition: the conversation's current Reading owner is mounted, but no
Workspace right-edge drawer entry is exposed. This preserves an explicit user
capability and focus-return invariant; it is not a stale selector or an
obsolete implementation oracle. The existing Round15 owner-gap assertion
records the same public absence.

AD-093 remains BLOCKED pending its explicitly assigned Reading/Workspace
product owner. The ledger therefore remains **329 PASS / 0 REGRESSION / 36
BLOCKED**. The case-level packet is in
[`A-D-ROUND43-AD093-READING-ENTRY-GAP-20260920.md`](./A-D-ROUND43-AD093-READING-ENTRY-GAP-20260920.md).
No duplicate red declaration, expected-fail completion, product source, or
private/compatibility API was added or changed.

## Round 44 — AD-093 real capability and owner definition

Round 44 separates the AD-093 capability from the generic Reading runtime. The
historical public contract is: `AppShell` edge button `打开最近阅读` →
`panel.open('reading-history')` → `RightPanelHost`/`RecentFilesContext` backed
by the recent-files port, with `ContextHost` restoring opener focus. In the
current composition the first boundary is `WorkspaceApp` panel/navigation plus
`WorkspaceLayout` shell; the dispatcher is `WorkspaceRightPanel`. It has no
Reading entry command or `reading-history` branch. The current Files surface's
inline “最近查看的文件” list is a different channel-files owner and is not
equivalent in scope, route, or focus lifecycle.

At shared HEAD `9896328` the ordinary public AD-093 fixture remains **1 failed
/ 19 focused-out skips** (`打开最近阅读` query returns `null`). AD-093 remains
BLOCKED pending the explicitly assigned Workspace/Reading owner; the ledger is
still **329 PASS / 0 REGRESSION / 36 BLOCKED**. The complete owner contract and
handoff packet is in
[`A-D-ROUND44-AD093-OWNER-DEFINITION-20260920.md`](./A-D-ROUND44-AD093-OWNER-DEFINITION-20260920.md).
Only the test annotation and A-D audit files changed; no product source,
private/compatibility API, or duplicate red declaration changed.

## Round 45 — AD-093 Shell port handoff and AD-099 next owner gap

At shared HEAD `d1ae978`, AD-093 carries the smallest proposed current public Shell contract in its
existing ordinary declaration: `WorkspaceLayout` renders the accessible
`打开最近阅读` entry when supplied the public
`navigation.openReadingHistory` port, and one click invokes that port once.
`WorkspaceApp`/`WorkspaceRightPanel` then own the Reading route while the
existing ContextHost owns close and opener-focus return. This is a handoff
contract for Shell, not a test-only product API; no product port was added.
The focused run remains **1 failed / 19 focused-out skips** because the entry is
not mounted.

The next independent Workspace case, AD-099, was rechecked through the
existing public navigation fixture: an invalid `c1` commit leaves the visible
heading at `选择频道` instead of rolling back to committed `c0` (**1 failed /
19 focused-out skips**). It remains a separate BLOCKED product-gap packet;
expected-fail declarations are not counted.

The ledger remains **329 PASS / 0 REGRESSION / 36 BLOCKED**. Case-level packets:
[`A-D-ROUND45-AD093-SHELL-PORT-HANDOFF-20260920.md`](./A-D-ROUND45-AD093-SHELL-PORT-HANDOFF-20260920.md)
and
[`A-D-ROUND45-AD099-INVALID-TARGET-OWNER-GAP-20260920.md`](./A-D-ROUND45-AD099-INVALID-TARGET-OWNER-GAP-20260920.md).
Only the existing A-D test contract annotation and audit files changed; no
product source, private/compatibility API, duplicate red declaration, or
expected-fail semantic changed.

## Public-boundary migration completed in this pass

`tests/channel-access.test.js` and `tests/channel-name-cache.test.js` no longer
import `createSessionAccess`, `accessMode`, `rememberChannelLabels`, or
`cachedChannelLabel`. Those helpers are private implementation details of
`useWireSession.js`; the tests now drive the exported `useWireConnection` hook
with a mocked OBS/Wire boundary and inspect the `accessRef` port consumed by
`WorkspaceApp`. This keeps the user-visible access, membership, serving, label,
restart, and cache invariants without widening production API surface.

`tests/agent-activity.test.js` keeps the explicit same-boot settle and boot-reset
assertions through the public `ChannelFeedRuntime` snapshot. The current owner
now retains the matching entry for the history terminal and clears it on the
new boot; no private tracker or compatibility API is used.

The two formerly red packets have reproducible public-owner boundaries:

- AD-011: admit live processing for `c0` in generation 1, disconnect, admit a
  failed terminal from history in generation 2 with the same boot, then inspect
  `runtime.getSnapshot().agentActivity`; the matching settled projection
  remains visible, then a boot change clears it. The owner is
  `ChannelFeedRuntime`'s public activity snapshot.
- AD-143: attach profiles for `c0`, `c0.public`, `c0.agent-runtime` (actor), and
  `c0.lobby`, with active membership only for `c0`, then inspect the public
  `useWireConnection().accessRef.rows()` port. The visible rows are exactly
  `c0` and `c0.public`; actor/lobby implementation rows stay hidden. No
  private helper is used by the reproduction.

## Focused verification

The focused slices were run with Vitest against current public owners:

| Slice | Result | Interpretation |
|---|---|---|
| `tests/channel-name-cache.test.js` | 8 passed | all eight cache/access cases pass through `useWireConnection().accessRef` |
| P0 public-owner fixture slices | 9 passed across Agent/Identity/Describe; AD-316 remains red | nine P0 rows now have one-to-one fixtures; the device refresh gap remains explicit |
| `tests/channel-access.test.js -t '\[AD-143\]'` | 1 passed | AD-143 public access rows hide actor/lobby implementation channels and preserve member/discoverable access facts |
| `tests/agent-activity.test.js -t '\[AD-011\]'` | 1 passed | AD-011 same-boot history terminal settles retained work, boot change clears it, and history-only processing cannot revive it |
| `tests/agent-activity.test.js tests/channel-access.test.js` | 13 passed | final direct owner regression packet is fully green; no registered A–D regression remains |
| `tests/agent-control.test.jsx -t '\[AD-(014|017)\]'` | 2 passed | AD-014/017: public Waiting composition now gates edit admission and restores interrupt overlay state |
| `tests/agent-control.test.jsx tests/task-controls-restore.test.jsx` | 21 passed | AD-018/021 now pass through the Waiting owner; AD-020's unrelated business-progress guard remains green |
| `tests/agent-information-architecture.test.jsx -t '\[AD-(022|031)\]'` | 2 passed | AD-022 authority gate and AD-031 cancelled-target cleanup pass through the Waiting owner |
| `tests/agent-information-architecture.test.jsx -t '\[AD-(032|038)\]'` | 2 passed | AD-032 interrupt supersession and AD-038 latest committed save owner pass through the Waiting hook |
| `tests/agent-information-architecture.test.jsx -t '\[AD-041\]'` | 1 passed | AD-041 interrupted terminal presents the stopped/resumable Agent bubble and stays out of ordinary failure/hold presentation |
| `tests/agent-selection.test.js -t '\[AD-062\]'` | 1 passed | AD-062 later same-Agent usage refreshes the live context projection and sparse terminal data does not clear it |
| `tests/workspace-layout-channel-focus.test.jsx -t '\[AD-103\]'` | 1 passed | AD-103 focuses only the committed target heading and preserves the no-scroll handoff through the public Workspace owner |
| `tests/artifacts.test.jsx -t '\[AD-123\]'` | 1 passed | AD-123 preserves explicit same-channel version relation and repeated resource references through ChannelReplica + feature-search |
| `tests/blocked-round15-activity-owner.test.js tests/blocked-round15-node-update.test.jsx tests/blocked-round15-terminal-owner.test.jsx` | 12 passed, 11 expected fail, 23 total | AD-094/095/098/100/101/102/104/107 pass through public Workspace owners; AD-096 has four green handoff declarations; AD-002–004, AD-093, AD-097/099, AD-105–106, AD-108, and AD-202–203 retain explicit public owner-gap reproductions |
| `tests/blocked-round16-public-owner.test.jsx tests/blocked-round15-activity-owner.test.js` | 18 passed, 3 expected fail, 21 total | 17 new public-owner rows pass; AD-002–004 remain explicit Operation-index owner gaps |
| `tests/blocked-round18-public-owner.test.jsx` | 5 passed, 15 expected fail, 20 total | AD-096/098/101/154/191 pass through current public shell/governance owners; the other 15 remain explicit target/create/convergence owner gaps |
| `tests/blocked-round19-public-owner.test.jsx` | 1 passed, 19 expected fail, 20 total | AD-101 re-verifies the mobile message-surface owner; the remaining navigation/create/convergence/control rows remain explicit gaps |
| `tests/blocked-round20-public-owner.test.jsx` | 6 passed, 14 expected fail, 20 total | AD-163/168/169/171/172/173 pass through public Feed/Replica owners; the remaining Waiting/startup rows retain fixture, owner, or capability-gap evidence |
| `tests/blocked-round21-public-owner.test.jsx` | 10 passed, 10 ordinary red, 20 total | AD-277/278/282/283/285/286/287/290/293/294 pass through public Replica/Feed owners; AD-157/158/167/170/182 and AD-284/288/289/291/292 remain BLOCKED product-gap evidence |
| `tests/blocked-round22-public-owner.test.jsx` | 10 passed, 10 ordinary red, 20 total | AD-295–AD-304 pass through public Feed/Replica/diagnostic owners; the ten Round21 red gaps retain precise ordinary-red evidence |
| `tests/blocked-round23-public-owner.test.jsx` | 20 ordinary red, 20 total | AD-002/003/004, AD-093/097/099/105/106/108, AD-149/150/151/152/153/155, and AD-192/193/194/195/196 retain precise public Activity/Workspace/Governance product-gap evidence |
| `tests/blocked-round24-public-owner.test.jsx` | 1 passed, 19 ordinary red, 20 total | AD-167 re-verifies the fixed Feed refresh admission owner; AD-027/037, AD-156/159–161, AD-165/166, AD-178, AD-197, AD-202/203, AD-256/257, AD-316, AD-331/334, and AD-363/364 retain precise public Waiting/Feed/Governance/Workspace/Composer/Devices evidence |
| `tests/blocked-round25-public-owner.test.jsx` | 5 passed, 15 ordinary red, 20 total | AD-157/158/167 reverify Feed grant/boot/probe admission; AD-288/289 verify the existing cursor clamp owner; AD-170/182/284/291/292 and AD-002/003/004/093/097/099/105/106/108/149 retain precise ordinary-red public owner evidence |
| `tests/blocked-round26-public-owner.test.jsx` | 20 ordinary red, 20 total | AD-027/037, AD-150–153/155, AD-156/159–161, AD-165/166/178, and AD-192–197 retain precise Waiting/Feed/Governance owner or fixture evidence; closed AD-157/158/167/288/289 are explicitly de-duplicated |
| `tests/blocked-round27-fixture-recovery.test.jsx` | 3 passed, 3 total | AD-027/178/196 are recovered through current public Waiting/Reading, Feed cache, and Governance command owners; the separate Round 26 ordinary-red packet remains the evidence source for the 17 unresolved rows |
| `tests/blocked-round24-public-owner.test.jsx tests/blocked-round25-public-owner.test.jsx -t '\[AD-(170|182|202|203|256|257|284|291|292|316)\]'` | 10 ordinary red, 30 skipped | Round 29 rechecks ten selected current-owner capability gaps without adding duplicate red declarations; all remain BLOCKED and are handed off case-by-case in the Round 29 packet |
| `tests/blocked-round30-fixture-recovery.test.jsx` | 2 passed | AD-306/307 use public `ChannelFeedRuntime` unread/acknowledgement ports to recover the two cursor fixtures without private exports or a duplicate red declaration |
| `tests/blocked-round24-public-owner.test.jsx tests/blocked-round25-public-owner.test.jsx -t '\[AD-(093|097|099|105|106|108|331|334)\]'` | 8 ordinary red, 32 skipped | Existing public WorkspaceLayout and ConversationPresentation/Composer assertions remain the unique red evidence for eight capability gaps; no result is counted as expected-fail completion |
| `tests/blocked-round24-public-owner.test.jsx -t '\[AD-(037|156|159|160|161|197)\]'` | 6 ordinary red, 14 skipped | Round 31 reuses the existing Waiting/Feed/Governance public-owner assertions; no selected row recovers to PASS |
| `tests/blocked-round26-public-owner.test.jsx -t '\[AD-(192|193|194|195)\]'` | 4 ordinary red, 16 skipped | Round 31 reuses the existing Governance public-owner assertions; no selected row recovers to PASS |
| `tests/blocked-round24-public-owner.test.jsx tests/blocked-round25-public-owner.test.jsx -t '\[AD-(093|097|099|105|106|108|170|182|256|257)\]'` | 10 ordinary red, 30 skipped | Round 32 reuses the existing WorkspaceLayout, Feed/Replica, and Composer public-owner assertions; no selected row recovers to PASS |
| Round 15–20 blocked packets combined | 42 passed, 59 expected fail, 101 total | seven packet files remain green as suites; expected-fail rows are unresolved evidence and are not counted as completion |
| A–D owner slices including Agent/Waiting/Composer/Artifact/Content/Workspace tests | PASS cases green; no registered regression case red | AD-011 and AD-143 are closed through their existing public owners; no AD-123 `it.fails` case remains |

Historical red assertions were not weakened, skipped, or deleted; their public
owner contracts now pass. The unrelated `tests/channel-replica-cache-redaction.test.js`
red result belongs to the deleted `feed-cache.test.js` successor (data-plane/F
scope), not to the 42-suite A–D baseline ledger.

## Boundary proof

- This verification commit changes only A–D tests and audit reports. The
  already-existing owner commits `e09169e` (Feed activity) and `6c880aa`
  (session access rows) were reviewed, not modified or amended here.
- Round 15 changes only the three `blocked-round15-*` tests and the evidence
  reports/ledger. It does not touch Feed runtime, node-update product code, or
  terminal/navigation product code; the 14 unresolved cases remain BLOCKED.
- Round 16 changes only `tests/blocked-round16-public-owner.test.jsx` and
  A–D evidence/ledger reports. It does not touch Feed runtime, terminal/node/
  restart product files, or any package boundary; the three Activity cases
  remain BLOCKED.
- Round 18 changes only `tests/blocked-round18-public-owner.test.jsx` and
  A–D evidence/ledger reports. It exercises the already-available
  `WorkspaceLayout` handoff gate and `ChannelAdministrationPanel` public
  failure/filter ports; it does not touch terminal/node/restart product code,
  flat/cache, Reading, Composer, or any package boundary. The 15 red
  assertions remain BLOCKED; AD-101 is now green through owner `3d1c061`.
- Round 19 changes only `tests/blocked-round19-public-owner.test.jsx` and
  A–D evidence/ledger reports. It does not touch Search, Reading, cache,
  Activity/Operation, product code, vendor, package, lockfile, or private
  exports. The 19 expected-fail assertions remain BLOCKED.
- Round 20 changes only `tests/blocked-round20-public-owner.test.jsx` and
  A–D evidence/ledger reports. It exercises public Waiting and Feed/Replica
  boundaries without modifying Feed, Reading, Workspace, vendor, package,
  lockfile, or private exports; the 14 expected-fail assertions remain
  BLOCKED and the six green rows are recorded individually.
- Round 21 changes only `tests/blocked-round21-public-owner.test.jsx` and
  A–D evidence/ledger reports. It exercises Feed/Replica and cursor behavior
  through public ports; the five priority Feed gaps and five cursor gaps are
  ordinary red BLOCKED evidence, while ten cursor rows are recorded PASS. No
  Feed, Replica, Reading, Workspace, vendor, package, lockfile, or private
  export changed.
- Round 22 changes only `tests/blocked-round22-public-owner.test.jsx` and A–D
  evidence/ledger reports. It rechecks the ten Round21 red gaps at their first
  public owners and adds green AD-295–AD-304 fixtures. No expected-fail
  assertion, product source, Feed/Replica implementation, vendor, package,
  lockfile, or private export changed.
- Round 23 changes only `tests/blocked-round23-public-owner.test.jsx` and A–D
  evidence/ledger reports. It adds twenty ordinary red Activity/Workspace/
  Governance owner reproductions; no expected-fail assertion, product source,
  vendor, package, lockfile, or private export changed.
- Round 24 changes only `tests/blocked-round24-public-owner.test.jsx` and its
  A–D evidence/ledger reports. It verifies the existing Feed owner fix for
  AD-167 and records nineteen ordinary red public-owner gaps; no product source,
  vendor, package, lockfile, or private export changed.
- Round 25 changes only `tests/blocked-round25-public-owner.test.jsx` and the
  A–D evidence/ledger reports. It promotes AD-157/158/288/289 after green
  public-owner verification, rechecks AD-167, and records fifteen ordinary red
  gaps. The already-landed owner fixes `fc7f692`, `5c46b7c`, and `ef67eaf` are
  only verified; no Feed, Workspace, Reading, Outbox, vendor, package,
  lockfile, or private export changed.
- Round 26 changes only `tests/blocked-round26-public-owner.test.jsx` and the
  A–D evidence/ledger reports. It de-duplicates the already-closed
  AD-157/158/167/288/289 rows and records twenty ordinary red
  Waiting/Feed/Governance owner or fixture gaps. No product source, vendor,
  package, lockfile, private export, compatibility API, or baseline
  declaration changed.
- Round 27 changes only `tests/blocked-round27-fixture-recovery.test.jsx` and
  the A–D evidence/ledger reports. It promotes only AD-027/178/196 after
  correcting their stale public fixtures, reclassifies ten directly observed
  non-equivalent owner results as capability gaps, and leaves seven no-owner
  rows BLOCKED. It does not modify Waiting, Reading, Feed, Replica, Governance,
  Workspace, vendor, package, lockfile, private exports, compatibility APIs,
  or baseline declarations.
- Round 29 changes only the case-level evidence packet and A–D audit/ledger
  reports. It reuses the existing ordinary-red public-owner assertions for ten
  current capability gaps, identifies `useComposerSubmissionRuntime` for
  AD-256/257 and the `SpaceDevices` command port for AD-316, and does not add a
  duplicate red test source. No product source, vendor, package, lockfile,
  private export, compatibility API, or baseline declaration changed.
- Round 30 changes only `tests/blocked-round30-fixture-recovery.test.jsx` and
  the A–D evidence/ledger reports. It recovers AD-306/307 through public
  `ChannelFeedRuntime` unread/acknowledgement behavior and reclassifies the
  existing AD-093/097/099/105/106/108/331/334 red assertions as capability
  gaps. It does not add duplicate red tests, modify Workspace/Reading/Composer/
  Feed product code, export a private helper, add a compatibility API, or
  delete/skip/weaken a baseline declaration.
- Round 31 changes only its case-level evidence packet and A–D ledger/
  verification references. It reuses the unique existing Round 24/26
  public-owner assertions for AD-037/156/159–161/192–195/197; all ten remain
  ordinary-red capability evidence, so no status changes. No Waiting, Feed,
  Replica, Governance, Workspace, Reading, product source, private export,
  compatibility API, or baseline declaration changed.
- Round 32 changes only its case-level evidence packet and A–D ledger/
  verification references. It reuses unique existing Round 24/25 assertions
  for AD-093/097/099/105/106/108/170/182/256/257; all ten remain ordinary red,
  with no status change. Governance is deferred pending the new owner
  candidate. No product source, private export, compatibility API, or baseline
  declaration changed.
- Round 35 migrates only AD-149 through the current public
  `WorkspaceRightPanel` → `GovernanceFeature.ChannelCreateModal` entry and
  hardens that owner to consume typed `port.creation` facts. A missing Shell
  `commands.enterChannel` port remains an explicit AD-153 contract gap; no
  Workspace/Shell owner was changed. The focused AD-149 test is green, the
  ledger is **325 PASS / 0 REGRESSION / 40 BLOCKED**, and no duplicate red
  declaration was added for AD-150–153/155.
- No Reading, Outbox, vendor, package manifest,
  lockfile, or private production export changed.
- No baseline declaration was deleted or skipped. BLOCKED rows remain explicit
  product-gap packets until a product owner supplies a current public owner.
