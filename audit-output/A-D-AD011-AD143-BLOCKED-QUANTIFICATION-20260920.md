# A–D AD-011 / AD-143 regression packets and BLOCKED quantification (2026-09-20)

This is a follow-up to
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md) and
[`A-D-UNIT-MIGRATION-VERIFICATION-20260920.md`](./A-D-UNIT-MIGRATION-VERIFICATION-20260920.md).
At creation, the packet classified 116 rows as `BLOCKED`. The P0 public-owner
fixture batch has since recovered nine rows (AD-057/058, AD-125–127, and
AD-138–141); the first P1 composed-interaction fixture batch has now fixed the
public-owner fixes for AD-014 and AD-017, so 105 rows remain blocked.
The subsequent Waiting-owner regression packet also closes AD-018 and AD-021;
the same-owner follow-up closes AD-022 and AD-031 as well; these were
REGRESSION rows, not part of the historical 105 BLOCKED count. The next pair closes
AD-032 and AD-038 under the same owner, also without changing BLOCKED count.
AD-316 remains an explicit blocked reproduction because the current
`SpaceDevices` owner submits but does not refresh its authoritative projection.
AD-041 is now closed by the current timeline presentation owner; this also does
not change the historical 105 BLOCKED count.
AD-062 is now closed by the current public parameter projection owner; this
also does not change the historical 105 BLOCKED count.
AD-103 is now closed by the existing `WorkspaceLayout` navigation owner; this
also does not change the historical 105 BLOCKED count. AD-123 is now closed by the
existing `feature-search` artifact projection owner; this also does not change
the historical 105 BLOCKED count. The final owner verification closes AD-011 via `e09169e`
and AD-143 via `6c880aa`; both are public-contract checks only and leave the
105 historical BLOCKED rows unchanged at that stage. Round 15 then added public evidence for 20 rows:
six terminal contracts moved to PASS, while 14 Activity, terminal, and
node-update owner gaps remain explicitly BLOCKED. Round 16 added a 20-row
evidence packet: AD-002–004 remain Operation-index capability gaps, while 17
Waiting/probe/presentation/Composer rows moved to PASS through current public
owners. Round 18 then added a 20-row target-handoff/governance packet: AD-096,
AD-098, AD-154, and AD-191 moved to PASS; the subsequent shell owner
`3d1c061` also closes AD-101. Round 19 adds a 20-row governance/permission/
navigation evidence packet; its one green assertion is the same newly closed
AD-101 owner and the other 19 remain explicit expected-fail evidence. The
current ledger total is therefore **77 BLOCKED** (**288 PASS / 0 REGRESSION /
77 BLOCKED**); no row is obsolete, deleted, or skipped. Round 20 adds the
next 20 previously-uncovered rows through public Waiting and Feed owners;
AD-163, AD-168, AD-169, AD-171, AD-172, and AD-173 move to PASS. The current
ledger is **71 BLOCKED** (**294 PASS / 0 REGRESSION / 71 BLOCKED**), with no
row judged obsolete, deleted, or skipped.

Round 21 adds ordinary red public-owner reproductions for the five priority
Feed/Replica gaps AD-157/158/167/170/182 and direct public cursor evidence for
AD-277/278/282–AD-294. Ten cursor rows now have equivalent green fixtures;
five cursor rows expose capability gaps rather than merely missing evidence.
The ledger is now **61 BLOCKED** (**304 PASS / 0 REGRESSION / 61 BLOCKED**).
The ten red assertions remain BLOCKED and are not expected-fail completion
signals.

Round 22 re-runs the ten red priority/cursor gaps with narrower ordinary-red
public-owner evidence and promotes AD-295–AD-304 through the current
Feed/Replica/diagnostic owners. The ledger is now **51 BLOCKED** (**314 PASS /
0 REGRESSION / 51 BLOCKED**); no expected-fail result is counted as
completion.

Round 23 adds ordinary red public-owner evidence for twenty remaining Activity,
Workspace terminal, create-channel, and governance rows. No row moves category
or status: the ledger remains **51 BLOCKED** (**314 PASS / 0 REGRESSION /
51 BLOCKED**), and red results are not expected-fail completion signals.

Round 24 adds twenty independent public-owner cases: AD-167 is re-verified
green after owner fix `5c46b7c`, while AD-027/037, AD-156/159–161, AD-165/166,
AD-178, AD-197, AD-202/203, AD-256/257, AD-316, AD-331/334, and AD-363/364
remain ordinary red BLOCKED evidence. The ledger is now **50 BLOCKED**
(**315 PASS / 0 REGRESSION / 50 BLOCKED**); no red assertion is expected-fail
completion and no product source was changed in this packet.

Round 25 adds the requested independent Feed verification and the next public
owner packet. AD-157/158/167 are reverified through current grant/boot/probe
admission; the already-landed cursor clamp owner also makes AD-288/289 green.
AD-170/182/284/291/292 and AD-002/003/004/093/097/099/105/106/108/149 remain
ordinary red BLOCKED evidence. The ledger is now **46 BLOCKED** (**319 PASS /
0 REGRESSION / 46 BLOCKED**); no red assertion is expected-fail completion and
no product source was changed in this packet.

## Minimal regression packets

### AD-011 — Activity retained-work settlement after reconnect

- Baseline anchor: `fae8b70:tests/agent-activity.test.js:62`, “lets history
  close retained work but never resurrect it, and clears on boot change”.
- User capability: after a reconnect, a terminal history fact may settle work
  retained from the previous connection, but a boot change must clear it and a
  history-only provisional fact must never recreate live activity.
- Invariants: activity is connection-generation scoped; history is allowed to
  close retained work but is not liveness evidence; boot is an authority epoch.
- Current public owner: `createChannelFeedRuntime()` and its public
  `runtime.getSnapshot().agentActivity` projection.
- Minimal setup/action: create the runtime for `c0`; grant history at
  generation 1 / `boot-a`; enqueue live processing for `req-1` and
  `agent:codex:1`; disconnect; grant history at generation 2 / `boot-a`;
  enqueue a failed history terminal for the same request; inspect the activity
  projection; then change to generation 3 / `boot-b` and verify the projection
  clears and history-only processing does not revive it.
- Baseline result: the retained Agent row is settled before the boot change,
  then the boot change yields an empty projection.
- Current result: the generation-2 history terminal settles the retained
  `agent:codex:1` entry, and generation-3 `boot-b` clears it. The focused
  public assertion is green in `tests/agent-activity.test.js -t '[AD-011]'`.
- Owner evidence: `e09169e` keeps same-boot retained entries available to the
  exact matching history terminal while preserving the generation/boot fences.
- Stale-fixture check: the successor uses the public runtime factory and
  protocol vocabulary, not the deleted activity tracker or a private export;
  the input rows retain the baseline source, generation, channel, request,
  sender, status, and terminal fields.

### AD-143 — Access rows hide implementation channels

- Baseline anchor: `fae8b70:tests/channel-access.test.js:16`, “always hides
  lobby and actor implementation channels and only permits writes in active
  member channels”.
- User capability: show user-facing channels only; allow writes to an active
  member channel, never to a public observer row or actor/lobby implementation
  row.
- Invariants: declaration, serving, membership, visibility, and write
  eligibility remain separate facts; implementation channels cannot become
  user destinations merely because OBS declares them.
- Current public owner: exported `useWireConnection()` through its `accessRef`
  port, the same access boundary consumed by `WorkspaceApp`.
- Minimal setup/action: attach profiles for `c0`, `c0.public`,
  `c0.agent-runtime` (`type: actor`), and `c0.lobby`; attach active membership
  only for `c0`; inspect `accessRef.current.state()` and `.rows()`.
- Baseline result: rows are exactly `c0` (`member_active`) and `c0.public`
  (`discoverable`); the public member row is the only write target.
- Recorded product-gap result (before the shared-worktree source diff): the
  public state facts correctly reported `c0` as open/member and `c0.public` as
  open/discoverable, but `.rows()` also returned `c0.agent-runtime` and
  `c0.lobby`. The preserved failure was at `tests/channel-access.test.js:142`
  (expected two rows, received four).
- Current result: the same public test now passes with exactly `c0` and
  `c0.public` rows. Owner evidence is commit `6c880aa`, which filters actor and
  lobby implementation profiles in the existing session-access owner. That
  product change is outside this packet and is not staged or amended here.
- Stale-fixture check: the successor drives the exported hook with a mocked
  OBS/Wire attach boundary and makes no import of the old access reducer or
  predicate. The actor/lobby profile shapes are the exact baseline inputs.

### Reproduction command and observed result

```text
npx vitest run tests/agent-activity.test.js tests/channel-access.test.js --reporter=verbose
```

Recorded pre-owner run on 2026-09-20: **2 files failed; 10 tests passed; 2
assertions red**. The two reds were AD-011 and AD-143 above. Current direct
verification is **2 files passed; 13 tests passed; 0 assertions red**, with
focused `[AD-011]` and `[AD-143]` runs both green. No test-only branch, skip,
weakened expectation, or product change was introduced by this packet.

## Quantification of the original 116 BLOCKED rows and current 46 remainder

The classification is an evidence triage, not a verdict on product scope:

| Category | Count | Rule |
|---|---:|---|
| 缺 owner (`OWNER_MISSING`) | 12 | The exact baseline capability has no single current public entry/owner, even where an adjacent feature exists. Round 20 adds AD-165/166 for channel-entry/reconnect freshness interests. |
| 缺 fixture / 等价证明 (`FIXTURE_MISSING`) | 24 | A current public owner is named, but no one-to-one setup/action/result fixture has been established; this does not claim the capability is absent. Round 22 promotes AD-295–AD-304; two cursor rows remain fixture-only. |
| 真实能力缺口 (`CAPABILITY_GAP`) | 10 | The ledger records the required user-facing capability/index as absent or explicitly non-equivalent at the current public surface. Round 25 promotes AD-157/158 and AD-288/289 after green public-owner verification; AD-170/182, AD-284/291/292, AD-002/003/004, and AD-202/203 remain. |
| **Total** | **46** | The remaining rows retain explicit blocked evidence; no row is obsolete, deleted, or skipped. |

### `OWNER_MISSING` — 12 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `channel-create-modal.test.jsx` | 6 | `AD-149`–`AD-153`, `AD-155`; `GovernanceFeature` has an adjacent create panel but no independent owner for the baseline four-step modal contract. AD-154 now has a green public draft/failure/retry fixture. |
| `control-actions.test.js` | 2 | `AD-256`–`AD-257`; no principal-scoped durable control-recovery owner. |
| `dynamic-form.test.js` | 2 | `AD-363`–`AD-364`; no public JSON-Schema/control-form owner for typed control payloads. |
| `channel-feed-startup.test.jsx` | 2 | `AD-165`–`AD-166`; no public channel-entry/reconnect/foreground freshness-interest owner. |

### `CAPABILITY_GAP` — 10 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `activity.test.js` | 3 | `AD-002`–`AD-004`; cross-channel Operation index/Center is absent. Search, task, and artifact owners are not an equivalent operation index. |
| `channel-list.test.jsx` | 2 | `AD-202`–`AD-203`; current `VersionIncompatible` is a protocol terminal, not a node-version/update capability, and no node-update port/UI is mounted. |
| `channel-feed-startup.test.jsx` | 2 | `AD-170`, `AD-182`; AD-157/158 now pass the fixed cache-admission contract, and AD-167 passes the fixed refresh-admission contract. |
| `cursors.test.js` | 3 | `AD-284`, `AD-291`, `AD-292`; AD-288/289 now pass the existing authority/head clamp owner `ef67eaf`. |

### `FIXTURE_MISSING` — 24 rows

These rows have a named current owner and an evidence successor, but the
successor is not yet a one-to-one public fixture for the baseline scenario.
The exact row IDs remain in the ledger; grouping by source makes the count
auditable:

| Baseline source | Count | Rows |
|---|---:|---|
| `agent-control.test.js` | 0 | `AD-014`, `AD-017` now have green public Waiting-composition fixtures (`tests/agent-control.test.jsx:110,171`) and are ledger PASS |
| `agent-information-architecture.test.jsx` | 2 | `AD-027`, `AD-037`; AD-034/039 now have green public Waiting fixtures in `tests/blocked-round16-public-owner.test.jsx` |
| `agent-selection.test.js` | 0 | `AD-057`, `AD-058` recovered in `tests/agent-selection.test.js:150,163` |
| `app-agent-probe-lifecycle.test.jsx` | 0 | AD-074 now has a green public `useAgentProbes` fixture in `tests/blocked-round16-public-owner.test.jsx` |
| `app-shell-terminal-split.test.jsx` | 6 | `AD-093`, `AD-097`, `AD-099`, `AD-105`–`AD-106`, `AD-108`; AD-096/098/101 now have green public fixtures in `tests/blocked-round18-public-owner.test.jsx`, alongside AD-094/095/100/102/104/107 in `tests/blocked-round15-terminal-owner.test.jsx` |
| `atoll-session.test.jsx` | 0 | `AD-125`–`AD-127` recovered in `tests/atoll-session.test.jsx:26,43,60` |
| `capabilities.test.js` | 0 | `AD-138`–`AD-141` recovered in `tests/agent-describe-capability-index.test.jsx:49,83,124,145` |
| `channel-feed-startup.test.jsx` | 5 | `AD-156`, `AD-159`–`AD-161`, `AD-178`; the Round 20 public boundary remains unable to supply the exact cached-context/Meta/body/arrival proof. |
| `channel-governance.test.js` | 6 | `AD-192`–`AD-197`; AD-191 now has a green public governance filter fixture in `tests/blocked-round18-public-owner.test.jsx` |
| `cursors.test.js` | 2 | `AD-306`–`AD-307`; Round 22 promotes AD-295–AD-304; Round 21 promoted AD-277/278/282/283/285/286/287/290/293/294 and reclassified AD-284/288/289/291/292 as capability gaps |
| `devices-panel.test.jsx` | 1 | `AD-316` |
| `dynamic-f3.test.jsx` | 2 | `AD-331`, `AD-334`; AD-327–329/333/335–338/340–343/350–351 now have green public presentation/Composer fixtures in `tests/blocked-round16-public-owner.test.jsx` |
| **Total** | **24** | Round 24 moves AD-167 to PASS; the remaining fixture rows retain explicit blocked evidence. |

The remaining categories above retain their ledger `BLOCKED` status. AD-014 and
AD-017 no longer count as fixture-missing: their public-owner fixtures are
faithful and now PASS after the minimal Waiting-owner lifecycle fix. A future
migration may add a public owner or a faithful fixture for the remaining rows
and then re-run the original capability/invariant; it must not infer
obsolescence from the current absence of evidence.

## Round 18 evidence packet

Round 18 selected 20 rows from the 82-row remainder while avoiding the
flat/cache, Reading, and Composer conflict surfaces:

- Target handoff: AD-096, AD-097, AD-098, AD-099, AD-101, AD-105, AD-106,
  AD-108.
- Create/failure owner: AD-149–AD-155.
- Governance/permission and convergence: AD-191–AD-195.

Focused command and result:

```text
npx vitest run tests/blocked-round18-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       5 passed | 15 expected fail (20)
```

The current rerun is **5 passed, 15 expected fail (20)**. The green rows are
AD-096 and AD-098 (the committed-target gate clears old terminal handoff
state), AD-101 (the mobile message-surface fact from owner `3d1c061`), AD-154
(the current governance side panel keeps draft input through submit and
externally projected ledger failure, then allows retry), and AD-191 (the
current governance member owner filters standard/foundation actors and
internal declarations). The 15 expected-fail rows remain BLOCKED: the current
public boundary has no same-channel reselect rollback, invalid-target
directory fallback, per-channel terminal visibility owner, independent create
modal, or full ledger/OBS/membership/serving convergence owner. Expected-fail
evidence is not counted as recovery and does not imply deletion or
obsolescence.

## Round 19 evidence packet

Round 19 selected 20 rows from the 78-row remainder at round start through
current public governance, permission/control, and navigation boundaries; the
concurrent AD-101 owner closure leaves 77 current blocked rows. It excludes
Search, Reading, cache/startup, and Activity/Operation. The independent
fixture is [`tests/blocked-round19-public-owner.test.jsx`](../tests/blocked-round19-public-owner.test.jsx).
It covers AD-097/099/101/105/106/108, AD-149–153/155, AD-192–197, and
AD-256–257. Every row records user capability, invariant, public owner,
setup/action, and observed result; expected-fail rows remain blocked evidence.

Focused result:

```text
npx vitest run tests/blocked-round19-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       1 passed | 19 expected fail (20)
```

AD-101 is the sole green assertion through the already landed mobile-surface
owner. The other 19 rows remain BLOCKED at their current public boundaries;
the ledger is **288 PASS / 0 REGRESSION / 77 BLOCKED**. Activity/Operation
AD-002–004 remain unchanged and no product owner was invented for them.

## Round 20 evidence packet

Round 20 selected the next 20 previously-uncovered rows through public
Waiting and ChannelFeedRuntime owners:
AD-027, AD-037, AD-156–AD-161, AD-163, AD-165–AD-173, AD-178, and AD-182.
The focused command was:

```text
npx vitest run tests/blocked-round20-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       6 passed | 14 expected fail (20)
```

Green rows are AD-163, AD-168, AD-169, AD-171, AD-172, and AD-173. The
expected-fail rows remain BLOCKED and are split in the current quantification
as follows:

- `OWNER_MISSING`: AD-165/166 have no public channel-entry/reconnect/
  foreground freshness-interest owner.
- `CAPABILITY_GAP`: AD-157/158/167/170/182 reproduce stale/revoked cache or
  missing trim/compact-closure behavior at the current Feed/Replica boundary.
- `FIXTURE_MISSING`: AD-027/037/156/159/160/161/178 retain the named public
  owner but lack a one-to-one public proof for the baseline context/Reading/
  Meta/body contract.

The ledger is now **294 PASS / 0 REGRESSION / 71 BLOCKED**. No expected-fail
case was promoted, deleted, skipped, or judged obsolete; product gaps were
returned as minimal reproductions without a cross-owner edit.

## Round 21 evidence packet

Round 21 adds the five priority Feed/Replica rows AD-157/158/167/170/182 as
ordinary red assertions, so their product behavior cannot be hidden behind an
expected-fail declaration. It also gives one-to-one public Feed/Replica
fixtures to AD-277/278/282–AD-294.

```text
npx vitest run tests/blocked-round21-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests       10 failed | 10 passed (20)
```

Ten cursor rows move to PASS: AD-277/278/282/283/285/286/287/290/293/294.
The ordinary red rows remain BLOCKED at the first public owner: the five
priority Feed gaps and AD-284/288/289/291/292. They are reproducible
capability gaps, not obsolete cases or migration completion. The ledger is
**304 PASS / 0 REGRESSION / 61 BLOCKED**.

## Round 22 evidence packet

Round 22 re-runs the ten ordinary red priority/cursor rows AD-157/158/167/170/182
and AD-284/288/289/291/292 at their first public Feed/Replica owners. It also
gives one-to-one public fixtures to the next cursor rows AD-295–AD-304.

```text
npx vitest run tests/blocked-round22-public-owner.test.jsx --reporter=verbose

Test Files 1 failed (1)
Tests      10 failed | 10 passed (20)
```

The ten priority rows remain ordinary red BLOCKED evidence; they are not
expected-fail completion signals. AD-295–AD-304 pass through the public
Feed/Replica/diagnostic owners and are promoted to PASS. The ledger is now
**314 PASS / 0 REGRESSION / 51 BLOCKED**. The remaining quantification is
OWNER_MISSING 12, FIXTURE_MISSING 24, and CAPABILITY_GAP 15; no row is
obsolete, deleted, skipped, or judged complete from a red result.

## Round 23 evidence packet

Round 23 selects twenty remaining BLOCKED rows with current public
Activity, Workspace, and Governance owners: AD-002/003/004,
AD-093/097/099/105/106/108, AD-149/150/151/152/153/155, and
AD-192/193/194/195/196.

```text
npx vitest run tests/blocked-round23-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests      20 failed (20)
```

All twenty remain ordinary red BLOCKED evidence at their first public owner.
They are not converted to `it.fails`, deleted, skipped, or judged obsolete;
the category counts and ledger status remain unchanged.

## Round 24 evidence packet

Round 24 adds twenty independent public-owner cases: AD-167 is re-verified
green through the fixed Feed refresh admission owner; AD-027/037, AD-156/159–161,
AD-165/166, AD-178, AD-197, AD-202/203, AD-256/257, AD-316, AD-331/334, and
AD-363/364 remain ordinary red reproductions. The focused result is **1 passed /
19 ordinary red (20 total)**. The current ledger is **315 PASS / 0 REGRESSION /
50 BLOCKED**. `CAPABILITY_GAP` decreases from 15 to 14 solely because AD-167
now has green public evidence; `OWNER_MISSING` remains 12 and
`FIXTURE_MISSING` remains 24. No red assertion is counted as completion.

## Round 25 evidence packet

Round 25 adds [`tests/blocked-round25-public-owner.test.jsx`](../tests/blocked-round25-public-owner.test.jsx)
with twenty public-owner declarations. It first re-verifies the requested
Feed cases AD-157/158/167, then records the current cursor owner for AD-288/289
and fifteen still-red rows: AD-170/182/284/291/292, AD-002/003/004,
AD-093/097/099/105/106/108, and AD-149.

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx --reporter=verbose

Test Files 1 failed (1)
Tests      5 passed | 15 failed (20)
```

AD-157, AD-158, AD-288, and AD-289 move from BLOCKED to PASS; AD-167 remains
PASS after its independent recheck. The fifteen red assertions remain
BLOCKED, not expected-fail completion. The ledger is **319 PASS / 0 REGRESSION /
46 BLOCKED**. `OWNER_MISSING` remains 12, `FIXTURE_MISSING` remains 24, and
`CAPABILITY_GAP` falls from 14 to 10. Existing owner fixes `fc7f692`, `5c46b7c`,
and `ef67eaf` were verified without product edits.

## Boundary audit

This packet changes A–D unit tests and audit-output reports only. It does not
modify Workspace, Reading, Outbox, Feed runtime, session-access product code,
vendor, package or lock files, export private production helpers, or
delete/skip baseline declarations. The existing owner commits `e09169e` and
`6c880aa` supply the two product closures; this packet only verifies their
public contracts. Round 15 adds the three `blocked-round15-*` public evidence
tests and leaves the 14 unresolved cases explicitly BLOCKED. Round 16 adds
`tests/blocked-round16-public-owner.test.jsx`; AD-002–004 remain explicitly
BLOCKED because the public Operation index is still absent.
Round 18 adds `tests/blocked-round18-public-owner.test.jsx` and promotes
AD-096, AD-098, AD-101, AD-154, and AD-191; the other 15 assertions remain
explicit BLOCKED evidence. Round 19 adds
`tests/blocked-round19-public-owner.test.jsx` with one green AD-101 recheck and
19 expected-fail governance/navigation/control assertions. No flat/cache,
Reading, Composer, Feed runtime, terminal product, vendor, package, lockfile,
or private production export changed. Round 22 adds
`tests/blocked-round22-public-owner.test.jsx` and the corresponding A–D audit
reports only; its ten red cases remain BLOCKED and its ten green cursor cases
are recorded individually. No product source, private export, package, or
lockfile changed. Round 23 adds
`tests/blocked-round23-public-owner.test.jsx` and corresponding A–D audit
evidence only; its twenty ordinary red cases remain BLOCKED. No product source,
private export, package, or lockfile changed.
Round 24 adds `tests/blocked-round24-public-owner.test.jsx` and its case-level
report only; AD-167 is promoted after verifying the existing owner fix, while
the other nineteen rows remain BLOCKED. No product source, vendor, package,
lockfile, or private export changed.
Round 25 adds `tests/blocked-round25-public-owner.test.jsx` and its case-level
report only. It promotes AD-157/158/288/289, re-verifies AD-167, and keeps
fifteen ordinary red rows BLOCKED. The existing Feed/cursor fixes are only
verified; no Feed, Workspace, Reading, Outbox, vendor, package, lockfile, or
private export changed, and no baseline declaration was deleted or skipped.
