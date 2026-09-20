# S-Z Round 48 — SZ149 sparse-suffix versus canonical max-sequence decision

Date: 2026-09-20
Baseline: `d4c5eb0`
Scope: read-only product-contract comparison for SZ149. No product source,
test source, store, compatibility layer, Workspace, Outbox, Composer, Vendor,
package, or lockfile was changed. SZ152 remains with the visibility owner and
is not revisited here.

## The old capability, precisely

The historical case
`fae8b70:tests/timeline-reading-integration.test.jsx:66-76` exercised the
deleted `pendingArrivalEvents` helper
([`useReadingSession.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useReadingSession.js:153)).
Its user-relevant behavior was not merely “slice an array”:

- a consumer could select every journal event newer than its previous revision,
  including a bounded overflow prefix whose stable root had collapsed multiple
  `rowIDs`;
- the transient Reading record merged one stable key to the maximum sequence
  while retaining the union of row identities until Presentation resolved
  visibility;
- a visible matching row could acknowledge the stable key, while a row outside
  the installed boundary remained pending.

The old test's first assertion (`previousRevision = 50`) proves that the
collapsed overflow sentinel at revision `76` was still considered part of the
newer suffix. Its second assertion (`previousRevision = 1000`) proves exact
revision slicing of the later `1001..1100` events.

## What the current owner actually publishes

The current chain is:

```text
ChannelReplica live journal
  -> timeline snapshot { revision, acknowledgedRevision, events[] }
  -> useTimelineArrivalReceipt
  -> active view-session durable records [stableKey, maxSeq]
```

The journal event still contains `{ revision, key, rowID, seq }`, and the
overflow path retains a `rowIDs` union internally. The durable bridge then
normalizes each key to its maximum finite positive sequence
([`view-session.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/view-session.js:50), [`useLiveArrivalReceipts.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useLiveArrivalReceipts.js:23)).
The typed journal acknowledgement is monotone through a revision; the durable
clear returns records/remaining but does not carry row identity
([`live-arrivals.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/live-arrivals.js:1)).

This gives a stronger contract in two dimensions:

1. one stable conversation/event identity cannot create duplicate durable
   records merely because multiple terminal envelopes collapsed onto that root;
2. finite max-sequence normalization and a typed monotone acknowledgement are
   explicit, bounded state facts rather than a private suffix helper.

It is not stronger in every user-visible dimension:

1. durable records no longer carry the transient `rowIDs` union, so a later
   projection cannot use the durable record alone to distinguish which exact
   collapsed terminal identity was visible;
2. the current browsing projection reports `arrivals.events.length` as its
   unseen count, while the durable store deduplicates by stable key. Repeated
   hot events for one root can therefore have a different transient count from
   the durable max-sequence cardinality;
3. `acknowledgeActiveReadingUnseen(channelID)` is channel-scoped over active
   views, not an exact `(viewKey, rowID, seq)` acknowledgement. That is a
   deliberate aggregate contract only if the product defines notification
   acknowledgement at channel scope.

These differences mean that “maxSeq/ack is stronger” cannot by itself be used
to declare the old sparse-suffix user capability obsolete.

## Product decision matrix

| Product choice | User-visible promise | Consequence for SZ149 |
|---|---|---|
| Adopt canonical maxSeq/ack as the new contract | Repeated collapsed events are one stable unread root; latest finite seq wins; channel-scoped typed acknowledgement is sufficient; exact per-terminal replay is not promised. | The old sparse-suffix test may be superseded as a deliberate contract migration, but only after the product owner records this granularity decision and aligns the transient unseen count with the chosen root-level semantics. This round does not close it. |
| Retain per-event/collapsed-row capability | Every newer event or exact terminal row identity remains distinguishable until its matching committed Presentation fact is resolved/acknowledged. | Current durable `[key,maxSeq]` is insufficient. Define a new public typed receipt carrying journal revision, stable key, row identity set, and seq/ack boundary. Do not restore `pendingArrivalEvents` or add a compatibility parser. |
| Leave granularity unspecified | No safe equivalence can be claimed between the old suffix and current durable state. | Keep SZ149 OPEN and hand the decision to the current Reading/notification owner; this is the current disposition. |

## User capability verdict

The current implementation covers the safer root-level capability—retain a
stable unread fact through detach/remount and clear it through a typed
monotone acknowledgement—but does not publicly prove the old per-event
suffix/row-identity capability. The two are not interchangeable for a user
who expects to distinguish multiple terminal rows under one stable root.

Accordingly SZ149 remains **OPEN / product decision required**, not obsolete
and not a compatibility target. The minimum ruling needed before closure is
whether the product's unread unit is a stable root at its latest sequence or a
set of independently visible collapsed row identities. No new owner or store
is justified until that ruling exists.

## Existing evidence and verification

The current owner tests remain the evidence boundary:

- [`live-timeline-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-timeline-arrivals.test.js:31) — journal retention, channel isolation, consumer detach, and typed prefix acknowledgement.
- [`live-presentation-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-presentation-arrivals.test.js:19) — source-revision slicing and stable-root/exact-envelope presentation facts.
- [`view-session.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/view-session.test.js:77) — durable stable identity and finite-sequence normalization boundary.
- [`blocked-round21-public-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/blocked-round21-public-owner.test.jsx:300) — existing large-window and repeated-root journal-owner evidence; not used to infer per-event durable equivalence.

Focused command:

```text
npx vitest run tests/live-timeline-arrivals.test.js \
  tests/live-presentation-arrivals.test.js \
  tests/view-session.test.js --reporter=dot
```

Result: **3 files passed; 13 tests passed**. No product changes were made in
this round.
