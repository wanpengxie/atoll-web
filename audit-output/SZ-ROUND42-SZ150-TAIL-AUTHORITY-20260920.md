# S-Z Round 42 — SZ150 production Timeline tail authority

Date: 2026-09-20  
Owner: S-Z unit-test / current Conversation Projection owner  
Decision: **current public successor proved; SZ150 can be closed at the public observable boundary**

## Unique fae mapping

| Case | Unique fae source contract | Current owner and public observable | Decision |
|---|---|---|---|
| SZ-150 | `fae8b70:tests/timeline-reading-integration.test.jsx:81-88` — the old `Timeline` integration asserted that `onReadLatest` only received the physical sequence after the production timeline confirmed the latest tail. | `useConversationProjection` is the current public Reading/Timeline owner. Its `viewport.tailCaughtUp` is derived from the committed activation, current generation/head/presentation/source revisions, visible tail evidence, and the DOM-installed high sequence. The public `onTailCaughtUp` receipt carries `physicalSeq` only for an unfiltered current tail; absent/zero or beyond-head evidence stays at `physicalSeq: 0`. | **GREEN successor.** `tests/sz-round42-tail-authority.test.jsx` proves the positive exact-tail receipt and the two fail-closed boundaries (no installed row, installed sequence beyond authoritative head). No old `onReadLatest` path or compatibility export is restored. |

## Public contract proved

```text
committed Timeline observation
  + following + atTail + visible surface
  + current generation/head/presentation/source authority
  + 0 < installedHighSeq <= authoritative head
  -> viewport.tailCaughtUp.physicalSeq = installedHighSeq
```

Before the committed Timeline supplies an installed tail row, the public
physical read boundary remains zero. A DOM claim beyond the authoritative
physical head also remains zero. The test does not infer a read from the last
materialized row or from the transport cursor alone.

The current callback's `physicalSeq` is the observable consumed by the Feed
notification owner; this case does not claim equivalence for the removed
`onReadLatest` function or any private helper.

## Adjacent cases kept separate

- SZ-146 and SZ-148 remain **BLOCKED** for their old role-clock/receipt
  contracts; Round 41 mapped their current Presentation observable but did not
  invent `role.latest`, `roleRevision`, or `roleChanges`.
- SZ-149 remains **OPEN**. Its old `pendingArrivalEvents` sparse/collapsed
  selection helper is deleted, and the current `arrivalReceipts` journal has a
  different public contract. No one-to-one successor was claimed here.

No Workspace, Reading product source, Outbox, Composer, Vendor, package,
lockfile, old API, compatibility fixture, or private export was changed.

## Verification

Focused command:

```text
npx vitest run tests/sz-round42-tail-authority.test.jsx tests/sz-round40-presentation-authority.test.jsx tests/sz-round41-role-observable.test.js tests/live-timeline-arrivals.test.js tests/live-presentation-arrivals.test.js --reporter=dot
```

Result: **5 test files passed, 16 tests passed**.
