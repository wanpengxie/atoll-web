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
REGRESSION rows, not part of the 105 BLOCKED count. The next pair closes
AD-032 and AD-038 under the same owner, also without changing BLOCKED count.
AD-316 remains an explicit blocked reproduction because the current
`SpaceDevices` owner submits but does not refresh its authoritative projection.
AD-041 is now closed by the current timeline presentation owner; this also does
not change the 105 BLOCKED count.
AD-062 is now closed by the current public parameter projection owner; this
also does not change the 105 BLOCKED count.
AD-103 is now closed by the existing `WorkspaceLayout` navigation owner; this
also does not change the 105 BLOCKED count. AD-123 is now closed by the
existing `feature-search` artifact projection owner; this also does not change
the 105 BLOCKED count. The final owner verification closes AD-011 via `e09169e`
and AD-143 via `6c880aa`; both are public-contract checks only and leave the
105 BLOCKED rows unchanged. Round 15 then added public evidence for 20 rows:
six terminal contracts moved to PASS, while 14 Activity, terminal, and
node-update owner gaps remain explicitly BLOCKED. The current ledger total is
therefore **99 BLOCKED**; no row is obsolete, deleted, or skipped.

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
| 缺 owner (`OWNER_MISSING`) | 11 | The exact baseline capability has no single current public entry/owner, even where an adjacent feature exists. |
| 缺 fixture / 等价证明 (`FIXTURE_MISSING`) | 83 | A current public owner is named, but no one-to-one setup/action/result fixture has been established; this does not claim the capability is absent. Nine P0 rows, two P1 rows, and six round-15 terminal rows now have public PASS fixtures. |
| 真实能力缺口 (`CAPABILITY_GAP`) | 5 | The ledger records the required user-facing capability/index as absent or explicitly non-equivalent at the current public surface. |
| **Total** | **99** | Nine P0 rows moved to PASS, two P1 rows moved from REGRESSION to PASS, and six round-15 terminal rows moved from BLOCKED to PASS after focused public-owner verification. |

### `OWNER_MISSING` — 11 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `channel-create-modal.test.jsx` | 7 | `AD-149`–`AD-155`; `GovernanceFeature` has an adjacent create panel but no independent owner for the baseline four-step modal contract. |
| `control-actions.test.js` | 2 | `AD-256`–`AD-257`; no principal-scoped durable control-recovery owner. |
| `dynamic-form.test.js` | 2 | `AD-363`–`AD-364`; no public JSON-Schema/control-form owner for typed control payloads. |

### `CAPABILITY_GAP` — 5 rows

| Baseline source | Rows | Evidence boundary |
|---|---:|---|
| `activity.test.js` | 3 | `AD-002`–`AD-004`; cross-channel Operation index/Center is absent. Search, task, and artifact owners are not an equivalent operation index. |
| `channel-list.test.jsx` | 2 | `AD-202`–`AD-203`; current `VersionIncompatible` is a protocol terminal, not a node-version/update capability, and no node-update port/UI is mounted. |

### `FIXTURE_MISSING` — 83 rows

These rows have a named current owner and an evidence successor, but the
successor is not yet a one-to-one public fixture for the baseline scenario.
The exact row IDs remain in the ledger; grouping by source makes the count
auditable:

| Baseline source | Count | Rows |
|---|---:|---|
| `agent-control.test.js` | 0 | `AD-014`, `AD-017` now have green public Waiting-composition fixtures (`tests/agent-control.test.jsx:110,171`) and are ledger PASS |
| `agent-information-architecture.test.jsx` | 4 | `AD-027`, `AD-034`, `AD-037`, `AD-039` |
| `agent-selection.test.js` | 0 | `AD-057`, `AD-058` recovered in `tests/agent-selection.test.js:150,163` |
| `app-agent-probe-lifecycle.test.jsx` | 1 | `AD-074` |
| `app-shell-terminal-split.test.jsx` | 9 | `AD-093`, `AD-096`–`AD-099`, `AD-101`, `AD-105`–`AD-106`, `AD-108`; AD-094/095/100/102/104/107 now have green public fixtures in `tests/blocked-round15-terminal-owner.test.jsx` |
| `atoll-session.test.jsx` | 0 | `AD-125`–`AD-127` recovered in `tests/atoll-session.test.jsx:26,43,60` |
| `capabilities.test.js` | 0 | `AD-138`–`AD-141` recovered in `tests/agent-describe-capability-index.test.jsx:49,83,124,145` |
| `channel-feed-startup.test.jsx` | 18 | `AD-156`–`AD-161`, `AD-163`, `AD-165`–`AD-173`, `AD-178`, `AD-182` |
| `channel-governance.test.js` | 7 | `AD-191`–`AD-197` |
| `cursors.test.js` | 27 | `AD-277`–`AD-278`, `AD-282`–`AD-304`, `AD-306`–`AD-307` |
| `devices-panel.test.jsx` | 1 | `AD-316` |
| `dynamic-f3.test.jsx` | 16 | `AD-327`–`AD-329`, `AD-331`, `AD-333`–`AD-338`, `AD-340`–`AD-343`, `AD-350`–`AD-351` |
| **Total** | **83** | Nine P0 rows, AD-014/017, and six round-15 terminal rows now PASS; AD-316 and the remaining terminal rows remain blocked with public reproductions. |

The remaining categories above retain their ledger `BLOCKED` status. AD-014 and
AD-017 no longer count as fixture-missing: their public-owner fixtures are
faithful and now PASS after the minimal Waiting-owner lifecycle fix. A future
migration may add a public owner or a faithful fixture for the remaining rows
and then re-run the original capability/invariant; it must not infer
obsolescence from the current absence of evidence.

## Boundary audit

This packet changes A–D unit tests and audit-output reports only. It does not
modify Workspace, Reading, Outbox, Feed runtime, session-access product code,
vendor, package or lock files, export private production helpers, or
delete/skip baseline declarations. The existing owner commits `e09169e` and
`6c880aa` supply the two product closures; this packet only verifies their
public contracts. Round 15 adds the three `blocked-round15-*` public evidence
tests and leaves the 14 unresolved cases explicitly BLOCKED.
