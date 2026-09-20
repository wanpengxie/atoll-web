# S-Z Round 38 — migrate browsing fold lease to the current latest-row owner

Date: 2026-09-20  
Owner: S-Z unit-test / current Timeline projection owner  
Previous evidence: `3b63a0d` (the removed `row.role.latest` consumer was recorded as a real regression)

## Owner decision

`useConversationProjection` is the current owner of the latest-row fact:

1. `currentEntryAuthority` admits a candidate only after the current Presentation, history coverage, and readable availability satisfy the authority rules.
2. The public viewport publishes the frozen `presentationAuthority` tuple, including `candidateID`.
3. The same hook derives `latestRowID` from that tuple and passes it to both Timeline rendering and browsing-fold lease reconciliation.

`browsing-fold-lease` now consumes that explicit `latestRowID` and resolves its visual slot only against the current immutable rows. It no longer reads a row `role` field. A row carrying only the removed `role.latest` shape is ignored, so this migration does not create a compatibility parser or revive role finalization. The lease effect also depends on `latestRowID`; a change in authority with an unchanged Presentation object cannot leave a stale lease.

## Current role cases

| Case | Current owner result |
|---|---|
| SZ-144 | **OPEN**. The latest-row consumer now uses the current authority fact, but no public exact authority-token/role-finalization contract exists. This change does not invent one. |
| SZ-146 | **OPEN**. No public monotonic role revision or role delta exists in Timeline/StructuredResult/Reading projection. |
| SZ-148 | **OPEN**. `commitCandidate` remains a projection receipt, not a one-shot latest-role candidate receipt. |

## Direct contract evidence

`tests/sz-round38-browsing-fold-lease.test.js` covers:

- explicit current `latestRowID` selects the latest visual slot;
- a role-only marker is ignored;
- an append retains the bookmarked slot until the reader witnesses the new tail;
- reciprocal replacement retains its canonical visual slot;
- following mode revokes the lease.

The existing Timeline typed/geometry set plus this owner test was run with:

```text
npx vitest run tests/sz-round38-browsing-fold-lease.test.js tests/sz-round36-timeline-geometry.test.js tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **7 test files passed, 29 tests passed**. `npm run build` passed (only the existing large-chunk warning remains).

Only the current lease consumer/model and its direct test were changed. No `role.latest` compatibility path, private export, old role API, Workspace, Composer, Outbox, Vendor, package, or lockfile change was made.
