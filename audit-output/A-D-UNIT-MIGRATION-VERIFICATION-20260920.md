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
- No Reading, Outbox, vendor, package manifest,
  lockfile, or private production export changed.
- No baseline declaration was deleted or skipped. BLOCKED rows remain explicit
  product-gap packets until a product owner supplies a current public owner.
