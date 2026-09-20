# S-Z Round 39 — current Presentation role-owner audit

Date: 2026-09-20  
Owner: S-Z unit-test / current Presentation and Timeline projection owners  
Previous migration: `af13740` (browsing fold lease consumes canonical `latestRowID`)

## Per-case decisions

| Case | User capability / invariant | Evidence from current public owner | Disposition |
|---|---|---|---|
| SZ-144 | Only an exact current presentation authority may designate the latest row; role cannot become geometry/content state. | `createConversationPresentation` publishes `currentEntryCandidate` separately from immutable rows. `useConversationProjection` privately gates the public `presentationAuthority` tuple before deriving `latestRowID`. The direct test shows a source `role.latest` marker is absent from materialized rows and cannot replace the current candidate. The exact authority-token matrix is not itself a public contract/test owner. | **OPEN regression package**; retain until the Timeline/Reading owner publishes the matrix or a direct public integration oracle. |
| SZ-146 | Latest-role changes need a separate monotonic role revision and must not rewrite content/geometry rows. | Current snapshots expose `revision`, `sourceRevision`, `changes`, rows, and `currentEntryCandidate`; no `roleRevision` or `roleChanges` is published. The direct test asserts those removed fields are absent. | **OPEN**; no current role-delta owner exists. |
| SZ-148 | A latest-role candidate is emitted once after commit and cannot be consumed twice. | The current public `commitCandidate` receipt is one-shot and the direct test verifies a second consume returns false. It is explicitly a projection receipt, not a latest-role receipt; no role candidate/consumption port exists. | **OPEN**; do not relabel the projection receipt as role equivalence. |

## Direct current-owner tests

`tests/sz-round39-role-owner.test.js` covers three public boundaries:

- current-entry candidate remains separate from row geometry and ignores a source `role.latest` marker;
- a control-only tail with a removed role marker cannot become the current entry;
- projection commit receipts are one-shot, while `roleRevision`/`roleChanges` remain absent.

The focused regression set was run with:

```text
npx vitest run tests/sz-round39-role-owner.test.js tests/timeline-presentation-identity.test.js tests/history-presentation-admission.test.js tests/sz-round38-browsing-fold-lease.test.js tests/sz-round36-timeline-geometry.test.js tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **10 test files passed, 70 tests passed**.

## Public-owner handoff

The remaining product gap is precise: the current hook has a private `currentEntryAuthority` decision and a public `presentationAuthority` value, but no public exact-token matrix that proves stale generation/view/source candidates are rejected. A future owner should publish that contract or an integration-level observable; this audit does not export the private helper, recreate `role.latest`, add a compatibility fixture, or invent role revisions.

No product source, Workspace, Composer, Outbox, Vendor, package, lockfile, or legacy role path was changed in this round.
