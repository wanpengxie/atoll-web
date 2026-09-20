# N–R Round 46 — no next unique baseline after TC0224 closure

Date: 2026-09-20  
Reviewed head: `36fcc4a` (`test(sz): fence replacement authority successor`)

## Unique-baseline decision

TC0224 is closed and remains supplementary Reading browser evidence; it is not
counted again. The N–R ledger still has **22 suites / 98 expanded rows**, with
`NR22-01` already recorded as the final unique baseline row. Therefore there is
no honest “next unique N–R baseline” to add in Round 46. Creating another test
for TC0224, NR19-01, or a historical oracle would double-count an existing row.

## Current public-owner spot checks

The current notification/runtime and rail boundaries remain green at the
reviewed head:

```text
npx vitest run \
  tests/notification-state-contract.test.js \
  tests/channel-feed-runtime.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  tests/workspace-channel-rail.test.jsx --reporter=dot
```

Result: **4 files, 49 tests passed**.

The Reading observation, notification policy, roster, and roster publication
subset also remains green:

```text
npx vitest run \
  tests/notification-fallback.test.js \
  tests/reading-observation-settle.test.jsx \
  tests/roster.test.js \
  tests/roster-self-from-attach.test.js --reporter=dot
```

Result: **4 files, 27 tests passed**. The diagnostic `history.viewport_underfilled`
lines emitted by the fixture are expected evidence, not test failures.

## Remaining unproven capabilities (not new baseline rows)

The first unresolved current-owner capability is not a test migration gap:

- `NR01` node update has no public owner (`BLOCKED-NR01`);
- `NR07`/`NR08` pane resizer and persisted pane-size owners are absent
  (`BLOCKED-NR04`/`BLOCKED-NR05`);
- `NR09` mobile tool-output abbreviation has no current owner
  (`BLOCKED-NR06`);
- `NR10` detail drawer/JSON/timestamp/live-duration progress behavior is not
  rendered by the current inline trail (`GAP-NR07`);
- `NR13-07` and the legacy portions of `NR14` depend on the retired selection
  owner or diagnostic `blockID` shape (`GAP-NR08`/oracle boundary).

These are genuine product-owner decisions, not grounds to export a private
helper, restore a deleted store/API, or add a duplicate baseline row. Current
surviving Reading/notification/roster contracts remain covered by their public
tests; TC0224 and NR19-01 evidence are already recorded in Rounds 42–45.

## Boundary audit

Round 46 changes only this audit. No `src/`, Reading owner, vendor, package, or
lockfile path was edited; no test was deleted or skipped; no private owner/API
was exported or imported.
