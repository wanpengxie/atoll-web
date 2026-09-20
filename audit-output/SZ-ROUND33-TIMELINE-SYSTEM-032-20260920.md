# S-Z round 33 — unavailable recovery and Timeline system-event owner

Date: 2026-09-20

Scope: close the missing service-recovery branch of `SZ-032`; locate the
current public Timeline/StructuredResult owners for `SZ-059`–`SZ-061`; and
perform the post-change Composer typed-port check for `SZ-028`, `SZ-033`, and
`SZ-034`.

Only owned tests and this audit report changed. No product source, Workspace,
Reading, Vendor, Outbox owner, package, lockfile, old path, compatibility
layer, private export, or central migration ledger changed.

## Result

| Row | Current public owner / direct evidence | Disposition |
|---|---|---|
| SZ-032 | `useComposerSubmissionRuntime` now has a direct recovery case in [`submission-outbox-current.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/submission-outbox-current.test.jsx:161): an `unavailable` transport refusal remains queued with its error fact, then a wire recovery retries the same frame id and reaches `accepted`. | **GREEN current owner**. The test observes exactly two submits and the same `m-recover` id; no automatic duplicate or new id is created. |
| SZ-059 | The current visible owner is `useTimelineRowRenderer` → its `Narration` row. The known `system.member.created` word is rendered as `成员已加入` and not as the raw wire type by [`sz-round33-timeline-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round33-timeline-owner.test.jsx:26). Structured terminal results remain owned by the nested `StructuredResult` path and its existing 9-case direct suite [`structured-result-restore.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/structured-result-restore.test.jsx:36). | **PARTIAL visible recovery; exact decoder contract remains OPEN**. The deleted closed decoder is not recreated. |
| SZ-060 | `Narration`/`textOf` is the current path, but [`textOf`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:146) chooses arbitrary `textContent` before the closed system-operation label. A system event carrying an untrusted `text` can therefore bypass its typed label. | **RED minimal renderer contract**: for a typed system event, arbitrary JSON field names (including `text`) must not become product prose; only the event type and its documented fields may be presented. No failing test was added as a substitute for the Presentation owner. |
| SZ-061 | The current [`Narration`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:477) prints the envelope sender name plus `textOf` output. It does not decode the canonical `member`/`decl_id` facts or apply the existing standard-actor identity policy. | **RED minimal renderer contract**: a canonical member-created fact must produce the member’s product-language title, while a standard actor such as `svcactor` must be hidden. No old `systemEventPresentation` module was restored. |

The exact S10 decoder rows are therefore not falsely marked green: SZ-059 has
one current visible-label proof but remains OPEN for typed validation and
unknown handling; SZ-060 and SZ-061 are small, reproducible renderer RED
packets. `StructuredResult` is a valid owner for terminal result payloads, not
a reason to force system-event decoding into a second presentation owner.

## SZ-032 recovery contract

The new case starts with an open wire whose submit rejects with
`code: "unavailable"`. The Composer runtime persists the row as `queued` and
retains the error. After the public `wireState` moves through reconnecting and
back to open, the current runtime transmits the existing row. The assertions
cover:

* the refusal is observable and remains queued;
* the first and second wire frames both carry `id: "m-recover"`;
* the recovered row reaches `accepted`; and
* the submit count is exactly two.

This is the service-recovery branch missing from the earlier related
`uncertain`/definitive-rejection case. It does not change the separate
membership-revocation or retired-channel handoffs.

## Timeline owner boundary and red packets

The current render chain is:

`channel-replica.state.narration` → `selectTimelineItems` narration row →
`useTimelineRowRenderer().renderRow` → `Narration`.

Known system words already have a closed label table in
[`TimelineRowRenderer.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:50),
which is enough for the one positive owner test. It is not a closed decoder:
the former `decodeSystemEvent` and `systemEventPresentation` modules are gone,
and the current renderer does not validate the required fields (`member`,
`decl_id`, `from`, `type`, `local_request_id`) or suppress standard actors.

The two product packets are intentionally minimal:

1. **SZ-060** — feed a typed system event whose body contains a valid
   documented fact plus `text: "伪造标题"`; the visible title must remain the
   canonical type-derived language, and the arbitrary text must not appear.
2. **SZ-061** — feed `system.member.created` with `member: "steward"` and a
   named declaration, then with `member: "svcactor"`/`decl_id: "svcactor"`;
   the first must identify the member in product language and the second must
   be hidden.

These packets identify the existing Presentation owner and do not authorize a
new decoder, a private export, or a second renderer.

## Composer typed-port post-verification

The candidate owner and typed ports were rerun after the SZ-032 addition:

```text
npx vitest run tests/composer-command-port.test.js tests/submission-correlation-port.test.js tests/submission-outbox-current.test.jsx tests/submission-outbox.test.jsx --reporter=dot
Test Files  4 passed (4)
Tests       33 passed (33)
```

This preserves the prior conclusions: the committed Composer command port
fences stale candidate cleanup; the correlation port is frozen, channel-scoped,
and landed-authoritative; exact queued membership-revocation/retired-channel
behavior remains with `composer_owner` and is not duplicated here.

The new owner evidence was also run directly:

```text
npx vitest run tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx --reporter=dot
Test Files  2 passed (2)
Tests       10 passed (10)

npx vitest run tests/submission-outbox-current.test.jsx --reporter=dot
Test Files  1 passed (1)
Tests       10 passed (10)
```

An exploratory run including the existing legacy-wrapper probe
`src/ui/timeline/message-body-presentation.test.jsx` still reports its known
old unwrapped-payload RED; that fixture is outside SZ-032/SZ-059–061 and was
not changed or counted as a new product result. No central ledger row was
rewritten.
