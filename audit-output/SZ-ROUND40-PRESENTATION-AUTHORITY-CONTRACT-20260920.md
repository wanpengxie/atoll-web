# S-Z Round 40 — canonical Presentation authority receipt

Date: 2026-09-20  
Owner: S-Z unit-test / current Timeline projection owner  
Previous audit: `90f2e8d` (role-owner boundary)

## Canonical public contract

The existing `viewport.presentationAuthority` is the canonical Presentation
authority receipt. No new product field is required:

```text
PresentationAuthorityReceipt | null = Readonly<{
  epoch: string,
  viewID: string,
  sourceRevision: number,
  candidateID: string,
}>
```

The receipt is non-null only when the current public projection is readable and
the candidate is authorized by the current head/coverage fence. Durable rows
need the current bottom/head proof; local candidates need authoritative-empty
or the equivalent current coverage proof. A source/readability/head fence
failure returns `null`. A new Presentation view or data epoch produces a new
receipt carrying that exact tuple. The receipt is frozen and carries no
`role`, `roleRevision`, geometry, or commit-consumption field.

The owner chain is:

```text
ConversationPresentation.currentEntryCandidate
  -> useProjectionReadingOwner.currentEntryAuthority (authority gate)
  -> viewport.presentationAuthority (public receipt)
  -> useConversationProjection.latestRowID
  -> TimelineRowRenderer / browsing-fold-lease consumers
```

The projection `commitCandidate` receipt remains a separate internal
projection-commit mechanism. It is not renamed as a role receipt and is not
used to recreate the removed role-finalizer API.

## Per-case disposition

| Case | Current public-owner evidence | Disposition |
|---|---|---|
| SZ-144 | Direct jsdom hook test observes the frozen four-field receipt, current `candidateID`, fail-closed head/readability/source fences, and re-issuance on view/epoch changes. Rows carry no role field; `latestRowID` is derived only from the receipt. | **CLOSED** with the current Presentation authority contract. |
| SZ-146 | No current public projection publishes a monotonic role revision or role delta. | **OPEN**; do not add `roleRevision`/`roleChanges` compatibility fields. |
| SZ-148 | Current `commitCandidate` is a one-shot projection commit receipt, not a latest-role candidate receipt. No role-candidate port exists. | **OPEN**; retain until a product owner defines a distinct current contract. |

## Direct evidence

`tests/sz-round40-presentation-authority.test.jsx` mounts the actual
`useConversationProjection` owner with a current Presentation/Replica fixture
and proves:

- exact frozen `{ epoch, viewID, sourceRevision, candidateID }` shape;
- `latestRowID` equals the authorized candidate and no role data is needed;
- stale head/coverage, unreadable status, and stale source revision fail closed;
- a changed view/epoch reissues a new receipt rather than reusing the old one.

Focused S-Z command:

```text
npx vitest run tests/sz-round40-presentation-authority.test.jsx tests/sz-round39-role-owner.test.js tests/timeline-presentation-identity.test.js tests/history-presentation-admission.test.js tests/sz-round38-browsing-fold-lease.test.js tests/sz-round36-timeline-geometry.test.js tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **11 test files passed, 73 tests passed**.

No product field, `role.latest` compatibility, `roleRevision`/`roleChanges`, private export, old role API, Workspace, Composer, Outbox, Vendor, package, or lockfile was changed.
