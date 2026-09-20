# S-Z round 32 — Composer typed-port alignment and five baseline checks

Date: 2026-09-20

Scope: independently verify the current typed Composer authority/correlation
ports against the carried-forward `SZ-028`, `SZ-033`, and `SZ-034` handoff
packet; preserve the explicit unsupported boundary for `SZ-021`; and inspect
the next five unproven baseline rows `SZ-032`, `SZ-040`, `SZ-059`, `SZ-060`,
and `SZ-061`.

This is a tests/audit pass only. No Workspace, Reading, Vendor, Outbox,
package, lockfile, old path, compatibility layer, private export, or product
source was changed. The existing Composer/Outbox owner remains singular.

## Result

The new typed ports independently prove the narrow authority and identity
boundaries, but they do not silently close the historical access-policy cases.
One of the five next baseline rows has an exact current-owner test; one is
partial; and the three system-event rows remain unresolved owner/regression
packets.

| Row | Current public owner and evidence | Disposition |
|---|---|---|
| SZ-028 | `createComposerCommandPort()` is the current committed command owner. The direct suite proves that an older candidate cleanup cannot retire a newer committed owner, and that all commands fail closed after the committed owner retires ([`composer-command-port.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/composer-command-port.test.js:184)). | **Authority boundary recovered; exact suspended-render integration remains OPEN**. The old candidate-render scenario is not claimed closed until the Composer owner demonstrates it through its public runtime. |
| SZ-033 | `createSubmissionCorrelationPort()` now supplies a stable, frozen, channel-scoped `{ channelId, messageId }` identity. The direct suite proves channel isolation, landed-wins-over-later-record, exact forget/reset, and malformed-identity rejection ([`submission-correlation-port.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/submission-correlation-port.test.js:6)). | **OPEN handoff to `composer_owner`**. The typed identity port does not itself revoke a pre-existing queued record when membership changes; no duplicate Outbox case was added. |
| SZ-034 | The same correlation port provides the identity needed to distinguish a pre-existing queued record from a later send, but it has no retired-channel policy. The current Outbox evidence covers a new send to a retired channel, not a previously queued record. | **OPEN handoff to `composer_owner`**. Preserve the old case as a behavior packet; do not infer closure from the new port. |
| SZ-021 | The integrated space panel remains explicitly unsupported: `WorkspaceApp` passes `disabled: true`, exposes the user-facing unavailable reason, and rejects `governance.space`; [`sz-round30-space-unsupported.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round30-space-unsupported.test.jsx:26) checks the boundary. | **Unsupported GAP retained**. No device-action compatibility path or fabricated success was introduced. |

The three Composer rows therefore remain a single-owner handoff: the typed
ports are supporting contracts, not a second Outbox implementation. The
historical handoff requirements remain:

* `SZ-028`: a suspended/candidate render must not publish transport authority
  or mutate the durable queue; only the last committed Composer owner may do
  so.
* `SZ-033`: a durable queued record must observe membership revocation before
  transmission, expose a terminal user-visible refusal, and not resurrect
  automatically when membership returns.
* `SZ-034`: a durable queued record must observe channel retirement before
  transmission, expose a closed-channel refusal, and not resurrect.

## Five next baseline rows

| Row | Exact baseline contract | Current evidence | Disposition |
|---|---|---|---|
| SZ-032 | `tests/submission-outbox.test.jsx` — keeps a retryable unavailable refusal queued and reuses its stable id once service recovers | The current owner keeps a retryable transport failure in `uncertain` and exposes explicit `retry`; [`submission-outbox-current.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/submission-outbox-current.test.jsx:161) passes. That path retries the same pending record but ends in a definitive rejection; it does not prove a service-recovery success with the original stable id. | **PARTIAL**, retain the recovery-success branch as unproven. |
| SZ-040 | `tests/submission-outbox.test.jsx` — treats receipt-before-feed as one attempt and leaves rejection/retry decisions to the user | The exact current Composer runtime case sends `m-receipt-first`, observes the accepted receipt, then reconciles the feed and asserts one submit with no duplicate attempt ([`submission-outbox.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/submission-outbox.test.jsx:215)). | **Recovered current owner / GREEN HANDOFF**. The central ledger is intentionally not rewritten in this audit; the evidence supersedes its stale no-owner note for follow-up bookkeeping. |
| SZ-059 | `tests/system-events.test.js` — decodes the closed backend contract by event type | The historical decoder module and suite are absent. The current protocol still defines the closed narration words in [`vocab.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/protocol/vocab.js:40), but no current public decoder owner proves typed validation/unknown handling. | **OPEN / product regression packet**. Do not recreate the deleted decoder as a compatibility path. |
| SZ-060 | `tests/system-events.test.js` — never guesses semantics from arbitrary JSON field names | `TimelineRowRenderer` has a closed system-label table, but [`textOf`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:146) gives arbitrary `textContent` precedence over the typed system label. A system payload carrying an untrusted `text` can therefore become visible prose. | **OPEN / real renderer regression packet** to the current Presentation owner. |
| SZ-061 | `tests/system-events.test.js` — maps canonical facts to product language and hides standard actors | Current narration materializes every system row and renders sender name plus body text in [`Narration`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:477). There is no current typed member-fact mapping or standard-actor suppression equivalent to the historical contract. | **OPEN / real renderer regression packet** to the current Presentation owner. |

The five-row count is therefore **1 exact current proof (SZ-040), 1 partial
(SZ-032), and 3 unresolved system-event packets (SZ-059–061)**. No old system
event decoder was restored, and no fixture gap was counted as a product green.

## Independent verification

The typed authority/correlation and current Composer owner suites were run
together:

```text
npx vitest run tests/composer-command-port.test.js tests/submission-correlation-port.test.js tests/submission-outbox-current.test.jsx tests/submission-outbox.test.jsx --reporter=dot
Test Files  4 passed (4)
Tests       32 passed (32)
```

The two carried-forward baseline paths were also run directly:

```text
npx vitest run tests/submission-outbox.test.jsx -t "receipt-before-feed" --reporter=dot
Test Files  1 passed (1)
Tests       1 passed | 8 skipped (9)

npx vitest run tests/submission-outbox-current.test.jsx -t "retryable transport failure" --reporter=dot
Test Files  1 passed (1)
Tests       1 passed | 8 skipped (9)
```

The skipped counts above are Vitest name-filter reporting; no test was
deleted or marked `skip`. No central migration-ledger row was rewritten.
