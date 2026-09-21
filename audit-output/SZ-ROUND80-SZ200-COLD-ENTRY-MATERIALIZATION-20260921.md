# SZ-200 — cold entry waits for the first current public range

Date: 2026-09-21
Base: `7acfe8755c8f09c593b6a02ea7e247556797e29f`
Owner: `useConversationProjection` → `useProjectionReadingOwner` viewport;
`VendorListExecutor` publishes the typed `materialized-range` receipt.
Test: `tests/sz200-cold-entry-materialization-public-owner.test.jsx`

## Baseline uniqueness

SZ-200 is the retained migration case from
`tests/timeline-reading-integration.test.jsx`: “冷入口只在Virtuoso报告当前activation首个公开range后退出materializing”. Its user contract is distinct from SZ-192's viewport-budget/settle lifecycle: this case establishes the first physical materialization receipt for a cold activation. No other current S-Z successor claims that first-range transition.

## Contract

When a cold activation changes from an empty projection to a non-empty current
Presentation, rows are available as data but the surface remains
`materializing` until the same Reading activation and Presentation revision
publish a non-negative public range. A stale activation, stale revision, empty
Presentation, or invalid range cannot close the state. The receipt is
transient Reading-owner state only; it is not a second store or persisted
compatibility field.

## Evidence

The test drives the current public `useConversationProjection` owner through
an empty cold entry, then commits one Presentation row. It observes
`availability: "materializing"`, `initializing: false`, and
`presentationPending: true`. Stale activation, stale revision, and a negative
start index are rejected while the viewport remains materializing. The exact
current activation/revision and range `{startIndex: 0, endIndex: 0}` are then
accepted once, after which the public viewport reports `readable` and
`presentationPending: false`.

Assertions use only the public projection/viewport and injected lifecycle
ports. No private refs, DOM internals, scheduler ledgers, or old
`ui.*` compatibility paths are inspected.

## Result

Focused Vitest: PASS (1 test), repeated 5/5. Adjacent SZ182/SZ180/SZ191 and
reading-observation/bottom-intent tests: PASS (6 files, 14 tests).
`npm run build`: PASS (existing chunk-size warning only).

Product change is limited to the existing Reading owner; no new store, owner,
protocol, vendor, package, or lockfile changes were made.
