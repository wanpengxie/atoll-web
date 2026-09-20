# A–D Round 23 ordinary public-owner product-gap evidence (2026-09-20)

This packet continues the A–D case ledger in
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md). It selects
twenty remaining BLOCKED rows whose current public boundary can be exercised:
AD-002/003/004, AD-093/097/099/105/106/108, AD-149/150/151/152/153/155,
and AD-192/193/194/195/196. Every assertion is an ordinary `it` test; no
expected-fail declaration is used. A red result is preserved product-gap
evidence, not completion.

## Focused verification

```text
npx vitest run tests/blocked-round23-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests       20 failed (20)
```

The failures are independent public-owner reproductions. No row is promoted,
deleted, skipped, or judged obsolete by this packet.

## Case evidence

| ID | User capability | Invariant and first public owner | Current observed result |
|---|---|---|---|
| AD-002 | Activity Center unifies terminal, WorkItem, and Operation facts with a public source. | Channel/request dedupe and public SourceRef; `selectFeatureSearchIndex`. | **RED**: the public index emits no Operation row. `CAPABILITY_GAP/BLOCKED`. |
| AD-003 | Duplicate Operations retain the latest unsettled state and hide completed work. | Channel/native operation ID is the dedupe boundary; `selectFeatureSearchIndex`. | **RED**: no Operation projection is emitted. `CAPABILITY_GAP/BLOCKED`. |
| AD-004 | Search finds visible in-progress Operations and returns their artifacts SourceRef. | Search consumes only visible public Operation projections; `searchFeatureIndex`. | **RED**: the public index has no searchable Operation row. `CAPABILITY_GAP/BLOCKED`. |
| AD-093 | A recent-reading drawer is available at the channel/terminal edge. | Reading owns the drawer source and return focus; `WorkspaceLayout`. | **RED**: no recent-reading button exists in the public Workspace surface. `FIXTURE_MISSING/BLOCKED`. |
| AD-097 | A fast reselect of the committed channel cancels a pending target. | The latest user selection owns pending handoff; `WorkspaceLayout`. | **RED**: only the first selection is recorded; the pending target is not cancelled. `FIXTURE_MISSING/BLOCKED`. |
| AD-099 | Invalid target rollback returns to the origin and ends the old pending handoff. | Rollback and committed identity share one navigation owner; `WorkspaceLayout`. | **RED**: the public surface exposes no origin rollback/heading handoff. `FIXTURE_MISSING/BLOCKED`. |
| AD-105 | Rapid A→B→A selection hands off only the latest target. | A stale pending target cannot replay focus or terminal effects; `WorkspaceLayout`. | **RED**: only the first selection is recorded. `FIXTURE_MISSING/BLOCKED`. |
| AD-106 | Leaving and returning retains that channel's terminal split. | Terminal/session/layout visibility is channel-scoped; `WorkspaceLayout` + `WorkspaceFeatures`. | **RED**: the returned channel has no retained terminal split. `FIXTURE_MISSING/BLOCKED`. |
| AD-108 | Closing one channel split cannot close another channel split. | Terminal visibility is isolated per committed channel; `WorkspaceLayout` + `WorkspaceFeatures`. | **RED**: the public surface does not retain the other channel's split. `FIXTURE_MISSING/BLOCKED`. |
| AD-149 | Create-channel opens an independent dialog and initially focuses its name. | Dialog owner handles focus and submit lifecycle; `GovernanceFeature`/`ChannelAdministrationPanel`. | **RED**: no independent create dialog/focus owner is exposed. `OWNER_MISSING/BLOCKED`. |
| AD-150 | Current-channel Agent can be included as a real Actor seat. | Seat candidates come from the public roster; `GovernanceFeature`. | **RED**: no selected current-channel Agent seat is exposed. `OWNER_MISSING/BLOCKED`. |
| AD-151 | Template body is read before submitting a public recipe. | Create cannot submit only a template ID; `GovernanceFeature`. | **RED**: no public template-body read is submitted before create. `OWNER_MISSING/BLOCKED`. |
| AD-152 | Missing template detail is a stable unavailable state, not business failure. | Missing detail cannot be fabricated as a recipe or failure; `GovernanceFeature`. | **RED**: no unavailable template-detail terminal is exposed. `OWNER_MISSING/BLOCKED`. |
| AD-153 | Create exposes four-step convergence and enters only after ready. | A command receipt cannot declare serving ready; `GovernanceFeature`. | **RED**: no four-step convergence region is exposed. `OWNER_MISSING/BLOCKED`. |
| AD-155 | Create dialog supports Escape/backdrop/focus trap and focus return. | Independent dialog owner controls the full lifecycle; `GovernanceFeature`/SidePanel. | **RED**: no independent create backdrop/focus owner is exposed. `OWNER_MISSING/BLOCKED`. |
| AD-192 | User selector accepts only present human principals. | Agent/retired principals cannot become human admission targets; `GovernanceFeature` + Composer command port. | **RED**: public selector does not expose the required human-only option contract. `FIXTURE_MISSING/BLOCKED`. |
| AD-193 | Create separately converges ledger, OBS, membership, and serving. | A command receipt cannot replace serving/membership facts; `GovernanceFeature`. | **RED**: no serving-ready convergence fact is exposed. `FIXTURE_MISSING/BLOCKED`. |
| AD-194 | Member operation separates ledger terminal from roster convergence. | Terminal receipt cannot fabricate roster; `GovernanceFeature`. | **RED**: no member-ready convergence fact is exposed. `FIXTURE_MISSING/BLOCKED`. |
| AD-195 | Compact closure retains ledger lifecycle without declaring missing business result ready. | Unavailable result cannot masquerade as completion; `GovernanceFeature`. | **RED**: only the submitted ledger message is exposed, not unavailable-result status. `FIXTURE_MISSING/BLOCKED`. |
| AD-196 | Failed compact closure remains observable without guessing a failure reason. | Failed and unavailable-result states remain distinct; `GovernanceFeature`. | **RED**: current public governance surface has no create action for this failure lifecycle. `FIXTURE_MISSING/BLOCKED`. |

## Ledger outcome

All twenty rows remain `BLOCKED`; this packet changes no ledger status. The
ledger remains **314 PASS / 0 REGRESSION / 51 BLOCKED**. Existing
quantification remains OWNER_MISSING 12, FIXTURE_MISSING 24, and
CAPABILITY_GAP 15. These ordinary red assertions are returned to the named
owners for product disposition; they are not converted to `it.fails`.

## Boundary audit

This packet changes only the new A–D test and A–D audit/ledger reports. It uses
the public Activity search projection, `WorkspaceLayout`/`WorkspaceFeatures`,
and `ChannelAdministrationPanel` boundaries. It does not modify product
source, Reading, Feed, Workspace, vendor, package, lockfile, or private
exports, and it does not delete or skip any baseline declaration.
