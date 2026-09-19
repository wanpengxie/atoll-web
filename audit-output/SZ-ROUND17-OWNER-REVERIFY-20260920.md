# S–Z round 17 owner re-verification

Date: 2026-09-20. Scope: the three priority daemon/Outbox cases plus 20
previously OPEN S–Z rows. This report records only public-owner evidence; it
does not add a compatibility export, delete a case, or claim an implementation
detail as a user capability.

## Priority rows

| Case | Public owner and evidence | Result |
|---|---|---|
| SZ-018 | `useWireConnection` → `accessRef.directory().devices`, exercised by `tests/space-administration.test.js` with a daemon declaration containing `key: secret`. | GREEN. The existing daemon display allow-list returns `id/name/status/description/online`; the direct test also asserts no `key` property and no serialized secret. |
| SZ-035 | `useComposerSubmissionRuntime` + `outbox-store`, direct case `does not downgrade an in-flight submission when access changes before its accepted receipt`. | GREEN. The record remains transmitting while access changes and settles accepted after the receipt. Outbox remains composer-owner scope. |
| SZ-039 | `useComposerSubmissionRuntime.reconcileFeed`, direct case `treats feed-before-receipt as landed without retransmitting or emitting another send phase`. | GREEN. Feed reconciliation removes the record once; the delayed receipt does not submit again. Outbox remains composer-owner scope. |

SZ-018's product correction is already present in the existing public owner;
this round adds only a field-level regression assertion. No new product source
edit was justified after the current-owner repros passed.

## Twenty OPEN rows reviewed

| Case | Result | Evidence / disposition |
|---|---|---|
| SZ-033, SZ-034 | OPEN | Old `it.each` queued-access cases have no current direct successor in the shared Composer owner file; leave for `composer_owner`, no duplicate Outbox packet. |
| SZ-096 | GREEN | `tests/live-timeline-arrivals.test.js` preserves an arrival across A→B→A detach/reattach and clears only on an explicit receipt. |
| SZ-097–SZ-099 | GREEN | `src/ui/conversation/channel-switch-identity.test.jsx` proves a new reading tree on channel change, one tree after repeated switches, and no duplicate-key warning. |
| SZ-122, SZ-123 | GREEN | `src/ui/conversation/scope-and-actor-filter.test.jsx` drives the real member-filter chip and stale-incarnation removal path. |
| SZ-143 | OPEN | Current Presentation successor proves source readiness without row replacement, but no direct public geometry-key contract is exported; retain rather than infer. |
| SZ-145 | GREEN | `tests/timeline-presentation-identity.test.js` keeps the current-entry candidate through prepend and ignores a control-only tail. |
| SZ-146 | OPEN | The old role-delta oracle has no direct current public test; retain pending an owner-level successor. |
| SZ-147 | GREEN | `tests/timeline-presentation-identity.test.js` accepts one projection candidate commit and rejects re-consuming the same receipt. |
| SZ-221, SZ-222 | OPEN | Current row-render successor documents that roster/authority and capability-label inputs no longer reach this owner; no replacement behavior is claimed. |
| SZ-224 | GREEN | `src/model/conversation-presentation-scope.test.js` checks each public projection frame during append growth and correlation backfill. |
| SZ-225 | OPEN | The retired standalone incremental-cache path is not a current user-facing owner; retain as an implementation-shape oracle pending ruling. |
| SZ-226 | GREEN | The same successor switches `selfId` on one Replica and proves the other person's scope is not inherited. |
| SZ-231 | OPEN | No public performance/iteration oracle proves the old rows-Map traversal property; retain. |
| SZ-242 | GREEN | `src/model/conversation-presentation-mine-rules.test.js` proves a human self-send remains ordinary self conversation, not delegated timer work. |
| SZ-258 | GREEN | `tests/ui-primitives.test.jsx` drives InlineConfirmation focus, Escape cancellation, and unmount focus return. |

The twenty-row review closes 12 rows and retains 8 OPEN. The three blocked
obsolete rows (SZ-011, SZ-272, SZ-273) remain blocked pending product/data
ruling; this report does not alter them.

## Verification

Passing targeted commands:

```text
npx vitest run tests/space-administration.test.js tests/submission-outbox.test.jsx --reporter=verbose
npx vitest run src/ui/conversation/channel-switch-identity.test.jsx src/ui/conversation/scope-and-actor-filter.test.jsx tests/timeline-agent-activity-filter.test.jsx tests/timeline-presentation-identity.test.js src/model/conversation-presentation-mine-rules.test.js src/model/conversation-presentation-scope.test.js tests/timers-restore.test.jsx tests/ui-primitives.test.jsx --reporter=verbose
npx vitest run tests/live-timeline-arrivals.test.js --reporter=verbose
```

The focused owner runs passed. A full production build was not used as a gate
for this audit; the known unrelated parser failure in the dirty attachment
hook remains outside this S–Z scope.
