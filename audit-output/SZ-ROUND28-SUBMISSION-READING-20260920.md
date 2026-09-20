# S-Z round 28 — SZ-001..010 owner split and five baseline handoffs

Date: 2026-09-20
Scope: `SZ-001`–`SZ-010`, plus the next five unproven S-Z baseline rows.

## Decision in one sentence

The old `tests/send-scroll-transaction.test.js` and
`src/model/send-scroll-transaction.js` paths are absent, so they are not
restored or wrapped.  The durable user capability that still exists is owned
by the public `ReadingSession` latest-intent API; geometry-measurement ordering
remains a Reading/DOM handoff, and the unrelated space-administration rows
remain GAPs.

## SZ-001..010 split

The successor test is
[`tests/sz-round28-submission-reading-owner.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round28-submission-reading-owner.test.js:16).
It exercises only the existing public exports from
[`src/model/reading-session.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/reading-session.js:323)
(`requestLatest`, `bindLatestIntentTargets`, `consumeLatestIntent`, and
`takeReadingControl`).  The test is evidence for a current owner; it does not
claim that an absent old test file has been recreated or that the central
legacy ledger rows are closed.

| Row | Classification | Current user capability / boundary | Evidence or handoff |
|---|---|---|---|
| SZ-001 | Current Reading owner | A send/latest action creates one explicit latest intent before later destination binding. | successor test line 17; `requestLatest` stores the intent at `reading-session.js:326`. |
| SZ-002 | Current Reading owner | A committed queued destination binds to the already-issued intent by stable message identity. | successor test line 33; `bindLatestIntentTargets` is the public correlation point. |
| SZ-003 | Current Reading owner | A mixed batch retains every distinct target identity (deduplicated, not collapsed to one message kind). | successor test line 48. |
| SZ-004 | Current Reading owner | Repeated same-id requests advance the public intent revision and replace the prior immutable intent. | successor test line 59; `requestLatest` increments `intentRevision`. |
| SZ-005 | Current Reading owner | A stale acknowledgement for an older id cannot consume the newer intent. | successor test line 68; `consumeLatestIntent` requires the current id, activation, and input epoch. |
| SZ-006 | Current Reading owner | Presentation revision/baseline and target identity remain separate facts in the intent. | successor test line 81; fields are retained separately by `requestLatest`. |
| SZ-007 | Old implementation oracle / OPEN handoff | “Unrelated post-baseline layout measurement must not become target geometry” is a DOM measurement ordering detail, not a public Submission API. | No one-to-one current owner was found. Handoff to Reading list/DOM geometry owner; no product patch here. |
| SZ-008 | Old implementation oracle / OPEN handoff | “Latest same-revision public target measurement wins when height decreases” is a measurement freshness rule, not exposed by the current Submission API. | No one-to-one current owner was found. Handoff with SZ-007 as one minimal geometry regression packet. |
| SZ-009 | Current Reading owner | A Waiting destination may be correlated against the captured baseline tail and presentation revision. | successor test line 93; explicit `baselineTailID`, `afterPresentationRevision`, and target id. |
| SZ-010 | Current Reading owner | User takeover invalidates the explicit send/latest intent and returns the session to browsing. | successor test line 107; `takeReadingControl` clears the intent. |

Rows `SZ-001`–`SZ-006` and `SZ-009`–`SZ-010` therefore have a current
public-owner proof.  Rows `SZ-007`–`SZ-008` remain OPEN because no current
public contract exposes the old target-row measurement protocol.  The smallest
product regression packet for that handoff is:

1. capture a target message identity and a baseline presentation revision;
2. deliver an unrelated post-baseline measurement before the target measure;
3. deliver a same-revision target measurement whose height decreases;
4. assert that the target identity/freshest target measure, not the unrelated
   measurement, drives the one typed list command.

This packet belongs to the Reading/list DOM geometry owner.  It does not add a
private export, revive the old module, or infer a product failure from the
missing implementation path.

## Five additional unproven baseline rows

The next five unresolved rows are all the S03 space-administration family.
They have no current public consumer/owner in this round and remain GAPs; no
compatibility path or replacement owner is invented.

| Row | Existing contract title | Disposition |
|---|---|---|
| SZ-014 | Builds actor template commands and protects system declarations. | GAP; explicit product decision and current owner required. |
| SZ-015 | Refuses a declaration name that cannot be an actor-id segment. | GAP; explicit product decision and current owner required. |
| SZ-016 | Targets overlay/profile at the source-channel system actor. | GAP; explicit product decision and current owner required. |
| SZ-017 | Materializes `local-device` in every channel template body. | GAP; explicit product decision and current owner required. |
| SZ-019 | Projects channel-scoped device authority separately from space inventory. | GAP; explicit product decision and current owner required. |

These dispositions agree with the central migration ledger
[`audit-output/SZ-NUMERIC-UNIT-MIGRATION.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/SZ-NUMERIC-UNIT-MIGRATION.md:62)
and do not alter it.

## Verification

Focused successor command:

```text
npx vitest run tests/sz-round28-submission-reading-owner.test.js --reporter=dot
Test Files  1 passed (1)
Tests       8 passed (8)
```

The adjacent current Waiting/processing/terminal owner suite was also run as
an exclusion check: 8 files, 58 tests passed.  It is not counted as new
SZ-001..010 evidence and no already-green Waiting/terminal product contract
was changed in this round.

Only this report and the successor test were added.  No `src/`, vendor,
package/lockfile, old-path, private-export, skip, or compatibility changes
were made.
