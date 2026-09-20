# S-Z Round 36 — role/geometry owner split

Date: 2026-09-20  
Owner: S-Z unit-test / current Timeline owner  
Base: `acac6c8` typed renderer contract; current source after this round

## Per-case owner decision

| Case | User capability / invariant | Current unique owner | Disposition |
|---|---|---|---|
| SZ-143 | A visible row must receive a fresh measurement/render revision when its content, published layout class, or local fold decision changes; the semantic row ID remains stable. | `useTimelineRowRenderer.rowRenderRevision` is consumed by `VendorListExecutor`; `RowContent` publishes `row.layoutClass` and `row.contentRevision` while Virtuoso keeps `row.id` as its key. | **CLOSED** with the minimal current-owner fix and direct test. |
| SZ-144 | Only the exact current presentation authority may designate the latest row; latest role must not become geometry/content state. | `useConversationProjection.currentEntryAuthority` computes the tuple and `useConversationProjection` hands `candidateID` to `TimelineRowRenderer` as `latestRowID`. There is no direct public role-finalization port or current owner test for the exact authority-token matrix. | **OPEN regression package**; do not restore the deleted role finalizer or export the private helper. |
| SZ-146 | Exact latest-role changes need a separate monotonic role revision and must not rewrite content/geometry rows. | Current `createConversationPresentation` exposes projection revision/rows only; no role-delta owner or `roleRevision` public port exists. | **OPEN regression package**; no replacement owner exists in Timeline/StructuredResult. |
| SZ-148 | A latest-role candidate is published once after commit and a receipt cannot be consumed twice. | Current `createConversationPresentation.commitCandidate` is a projection receipt, not a latest-role candidate owner; existing SZ-147 evidence cannot prove the removed role contract. | **OPEN regression package**; retain rather than infer equivalence. |

## SZ-143 implementation

The Timeline row measurement signature now includes `row.layoutClass` alongside the existing `contentRevision`, latest/fold, edit, approval, and action inputs (`src/ui/timeline/TimelineRowRenderer.jsx:584-587`). This is a one-field owner-local change: it does not add a store, export an internal geometry helper, or revive the deleted `presentationGeometryKey` API. `VendorListExecutor` already applies the same layout class and content revision to the row (`src/ui/timeline/VendorListExecutor.jsx:50-59`), so the revision and painted class now have one coherent public owner.

The direct owner test proves content, `rich` versus `normal` layout, and a local `done:body` fold override each produce a different revision while an unchanged row remains stable: `tests/sz-round36-timeline-geometry.test.js:28-41`.

## Typed renderer re-verification

The Round-35 typed renderer safety suite remains green after the Timeline revision change:

```text
npx vitest run tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **5 test files passed, 25 tests passed**. Adding the SZ-143 owner case gives **6 files / 26 tests passed**. Production build also passed (`npm run build`).

## Non-closure boundary

SZ-144/146/148 remain explicit OPENs because the current code has no public role owner for those exact contracts. The current authority tuple and projection receipt are documented as evidence, not silently treated as a role API. No compatibility parsing, private export, old role finalizer, Workspace/Reading/Composer change, or StructuredResult change was made.

