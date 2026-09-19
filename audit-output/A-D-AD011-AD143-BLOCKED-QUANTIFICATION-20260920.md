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
AD-098, AD-154, and AD-191 moved to PASS; the remaining 16 remain explicit
expected-fail evidence. The current ledger total is therefore **78 BLOCKED**
(**287 PASS / 0 REGRESSION / 78 BLOCKED**); no row is obsolete, deleted, or
skipped.

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

## Quantification of the original 116 BLOCKED rows and current 99 remainder

The classification is an evidence triage, not a verdict on product scope:

| Category | Count | Rule |
|---|---:|---|
| 缺 owner (`OWNER_MISSING`) | 10 | The exact baseline capability has no single current public entry/owner, even where an adjacent feature exists. |
| 缺 fixture / 等价证明 (`FIXTURE_MISSING`) | 63 | A current public owner is named, but no one-to-one setup/action/result fixture has been established; this does not claim the capability is absent. Nine P0 rows, two P1 rows, six round-15 terminal rows, 17 round-16 rows, and four round-18 rows now have public PASS fixtures. |
| 真实能力缺口 (`CAPABILITY_GAP`) | 5 | The ledger records the required user-facing capability/index as absent or explicitly non-equivalent at the current public surface. |
| **Total** | **78** | Nine P0 rows, two P1 rows, six round-15 terminal rows, 17 round-16 public-owner rows, and four round-18 public-owner rows now PASS; the remaining rows retain explicit blocked evidence. |

### `OWNER_MISSING` — 10 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `channel-create-modal.test.jsx` | 6 | `AD-149`–`AD-153`, `AD-155`; `GovernanceFeature` has an adjacent create panel but no independent owner for the baseline four-step modal contract. AD-154 now has a green public draft/failure/retry fixture. |
| `control-actions.test.js` | 2 | `AD-256`–`AD-257`; no principal-scoped durable control-recovery owner. |
| `dynamic-form.test.js` | 2 | `AD-363`–`AD-364`; no public JSON-Schema/control-form owner for typed control payloads. |

### `CAPABILITY_GAP` — 5 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `activity.test.js` | 3 | `AD-002`–`AD-004`; cross-channel Operation index/Center is absent. Search, task, and artifact owners are not an equivalent operation index. |
| `channel-list.test.jsx` | 2 | `AD-202`–`AD-203`; current `VersionIncompatible` is a protocol terminal, not a node-version/update capability, and no node-update port/UI is mounted. |

### `FIXTURE_MISSING` — 63 rows

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
| `app-shell-terminal-split.test.jsx` | 7 | `AD-093`, `AD-097`, `AD-099`, `AD-101`, `AD-105`–`AD-106`, `AD-108`; AD-096/098 now have green public fixtures in `tests/blocked-round18-public-owner.test.jsx`, alongside AD-094/095/100/102/104/107 in `tests/blocked-round15-terminal-owner.test.jsx` |
| `atoll-session.test.jsx` | 0 | `AD-125`–`AD-127` recovered in `tests/atoll-session.test.jsx:26,43,60` |
| `capabilities.test.js` | 0 | `AD-138`–`AD-141` recovered in `tests/agent-describe-capability-index.test.jsx:49,83,124,145` |
| `channel-feed-startup.test.jsx` | 18 | `AD-156`–`AD-161`, `AD-163`, `AD-165`–`AD-173`, `AD-178`, `AD-182` |
| `channel-governance.test.js` | 6 | `AD-192`–`AD-197`; AD-191 now has a green public governance filter fixture in `tests/blocked-round18-public-owner.test.jsx` |
| `cursors.test.js` | 27 | `AD-277`–`AD-278`, `AD-282`–`AD-304`, `AD-306`–`AD-307` |
| `devices-panel.test.jsx` | 1 | `AD-316` |
| `dynamic-f3.test.jsx` | 2 | `AD-331`, `AD-334`; AD-327–329/333/335–338/340–343/350–351 now have green public presentation/Composer fixtures in `tests/blocked-round16-public-owner.test.jsx` |
| **Total** | **63** | Nine P0 rows, AD-014/017, six round-15 terminal rows, 17 round-16 public-owner rows, and four round-18 public-owner rows now PASS; AD-316 and the remaining terminal/governance rows remain blocked with public reproductions. |

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
Tests       4 passed | 16 expected fail (20)
```

The four green rows are AD-096 and AD-098 (the committed-target gate clears
old terminal handoff state), AD-154 (the current governance side panel keeps
draft input through submit and externally projected ledger failure, then
allows retry), and AD-191 (the current governance member owner filters
standard/foundation actors and internal declarations). The 16 expected-fail
rows remain BLOCKED: the current public boundary has no same-channel reselect
rollback, invalid-target directory fallback, mobile surface fact, or
per-channel terminal visibility owner, and no independent create modal or
full ledger/OBS/membership/serving convergence owner. Expected-fail evidence
is not counted as recovery and does not imply deletion or obsolescence.

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
Round 18 adds `tests/blocked-round18-public-owner.test.jsx` and promotes only
AD-096, AD-098, AD-154, and AD-191; the other 16 assertions remain explicit
BLOCKED evidence. No flat/cache, Reading, Composer, Feed runtime, terminal
product, vendor, package, lockfile, or private production export changed.
