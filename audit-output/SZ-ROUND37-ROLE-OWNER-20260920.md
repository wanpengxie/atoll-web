# S-Z Round 37 — role-owner audit and SZ-143 re-verification

Date: 2026-09-20  
Owner: S-Z unit-test / current Timeline owner  
Reference: `ad20457` (SZ-143 Timeline geometry diff and canonical-tail browser migration)

## Per-case owner decision

| Case | User capability / invariant | Current public path observed | Disposition |
|---|---|---|---|
| SZ-143 | A visible row gets a new measurement/render revision when content, published layout class, or local fold state changes while its semantic ID stays stable. | `useTimelineRowRenderer.rowRenderRevision` includes `contentRevision`, `layoutClass`, latest/fold, editing, approval, and action inputs; `VendorListExecutor` consumes the revision and applies the row's layout class. | **CLOSED**; independently re-verified from `ad20457` with the direct owner test. |
| SZ-144 | Only the exact current presentation authority designates the latest row; role must not become geometry/content state. | `currentEntryAuthority` computes `{ epoch, viewID, sourceRevision, candidateID }`; the public viewport exposes `presentationAuthority`, and `useConversationProjection` passes its `candidateID` to Timeline as `latestRowID`. There is still no public exact authority-token/role-finalization contract. | **OPEN regression package**; do not infer a role owner from this wiring or restore the deleted finalizer. |
| SZ-146 | Exact latest-role changes use a separate monotonic role revision and do not rewrite content/geometry rows. | `createConversationPresentation` exposes projection rows/revision and current-entry candidates only. No current Timeline/StructuredResult/Reading projection publishes a public role revision or role delta. | **OPEN regression package**; no current owner exists. |
| SZ-148 | A latest-role candidate is emitted once after commit and a receipt cannot be consumed twice. | `commitCandidate` returns a projection commit receipt; it is not a latest-role candidate port and has no role-consumption contract. | **OPEN regression package**; do not treat the projection receipt as role equivalence. |

## SZ-143 independent re-verification

The `ad20457` owner-local change adds `row.layoutClass || ''` to the Timeline render/measurement revision. The direct test covers changed content, `normal` versus `rich` layout, and a local `done:body` fold override while keeping an unchanged row stable (`tests/sz-round36-timeline-geometry.test.js`). No private geometry export, old role API, or compatibility parser is involved.

The typed renderer safety set was re-run together with the SZ-143 owner test:

```text
npx vitest run tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx tests/sz-round36-timeline-geometry.test.js --reporter=dot
```

Result: **6 test files passed, 26 tests passed** (the typed set is 5 files / 25 tests). `npm run build` also passed.

## Role-owner boundary found in the current projection

The current projection rows no longer publish a `role` field. Nevertheless, `reconcileBrowsingFoldLease` still discovers its latest row by scanning `row.role.latest`. That is evidence of a removed role-finalization dependency, not evidence of a current public role owner. Replacing it with an inferred role or accepting both shapes would be compatibility work and is outside this audit. The issue remains in the regression package until a product owner publishes a current role/authority contract.

No source, Workspace, Reading, Composer, Outbox, Vendor, package, lockfile, private export, compatibility layer, or old role API was changed in this round.
