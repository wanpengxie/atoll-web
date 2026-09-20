# S-Z Round 41 — fae role-contract mapping to current observables

Date: 2026-09-20  
Owner: S-Z unit-test / current Presentation and Timeline owners  
Authority contract: `b5ad7c5` (`viewport.presentationAuthority`)

## Unique fae mappings

| Case | Unique fae source contract | Current owner and public observable | Decision without restoring role APIs |
|---|---|---|---|
| SZ-146 | `fae8b70:tests/timeline-presentation-identity.test.js:384-421` — `createConversationRoleFinalizer` emitted `roleRevision`/`roleChanges` while preserving the geometry key. | `useProjectionReadingOwner.presentationAuthority` supplies the exact current candidate; `useConversationProjection.latestRowID` feeds `useTimelineRowRenderer`. A latest-ID change changes the public row render revision and FoldableBody latest/fold behavior, while the row's `contentRevision`/`layoutClass` and semantic identity remain stable. Evidence: `tests/sz-round40-presentation-authority.test.jsx`, `tests/sz-round41-role-observable.test.js`, and the existing Timeline geometry/fold tests. | **Current user capability covered.** The old role clock/delta shape is an obsolete implementation oracle and remains blocked; no `roleRevision`/`roleChanges` field is needed. |
| SZ-148 | `fae8b70:tests/timeline-presentation-identity.test.js:440-457` — latest-role candidate receipt was evaluated/committed once through the deleted role finalizer. | Current Presentation `commitCandidate` is the unique commit owner; duplicate projection receipts are rejected, and the committed snapshot's `currentEntryCandidate` plus public authority receipt keep the same latest observable. Evidence: `tests/timeline-presentation-identity.test.js` projection-receipt case, `tests/sz-round40-presentation-authority.test.jsx`, and the replay case in `tests/sz-round41-role-observable.test.js`. | **Current user capability covered at projection level.** The literal latest-role receipt is not claimed equivalent: no role candidate/role-consumption port exists, so the old exact oracle remains OPEN/BLOCKED pending product verdict. |

## Observable contract boundary

`presentationAuthority` covers the user-visible identity/fold decision:

```text
authority.candidateID -> latestRowID -> rowRenderRevision/FoldableBody latest
```

It does not expose an implementation clock or a second role receipt. The
current observable is therefore “the authorized current row changes its
render/fold decision once, with stable semantic/content/geometry identity,”
not “a role object with a monotonic revision was published.” Duplicate
projection receipt delivery is a no-op, which is the only current commit
observable required by the public Presentation owner.

No `role.latest`, `roleRevision`, `roleChanges`, private export, old
role-finalizer, compatibility fixture, Workspace, Composer, Outbox, Vendor,
package, or lockfile was added or restored.

## Verification

Focused command:

```text
npx vitest run tests/sz-round40-presentation-authority.test.jsx tests/sz-round41-role-observable.test.js tests/sz-round39-role-owner.test.js tests/timeline-presentation-identity.test.js tests/sz-round38-browsing-fold-lease.test.js tests/sz-round36-timeline-geometry.test.js tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **11 test files passed, 56 tests passed**.
