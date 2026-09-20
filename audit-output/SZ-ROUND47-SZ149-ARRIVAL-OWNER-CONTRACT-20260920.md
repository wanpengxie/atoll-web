# S-Z Round 47 — SZ149 arrival journal and durable Reading contract

Date: 2026-09-20
Baseline: `97ba8dc`
Scope: read-only owner/observable audit. No product source, test source,
store, compatibility layer, Workspace, Outbox, Composer, Vendor, package, or
lockfile was changed. SZ152 is intentionally out of scope for this round.

## Unique owner and fact flow

`ChannelReplica` is the sole mutable owner of the live timeline arrival
journal. `useTimelineArrivalReceipt` is the sole Timeline bridge into the
durable Reading view-session store. No renderer or list executor owns a second
arrival cursor.

```text
live Replica commit (source = live)
  -> notificationDisposition + self/entry qualification
  -> ChannelReplica._liveArrivalLog / _liveArrivalOverflow
  -> state.arrivalReceipts.timeline()
  -> useTimelineArrivalReceipt
  -> view-session.recordLiveArrivals
  -> active browsing view's durable [stableKey, maxSeq] records
  -> exact visible acknowledgement:
       typed Replica timeline command + active Reading durable clear
```

The producer is invoked only from the accepted Replica commit path
([`channel-replica.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:730)); history/cache rows do not
invent a live-arrival fact. `recordLiveTimelineArrival` first classifies the
envelope and admits only viewport-notifiable dispositions that involve the
current self actor
([`notification-policy.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/notification-policy.js:43), [`channel-replica.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:513)).

## Public state and authority tuples

These are the smallest current tuples that can be stated without restoring the
deleted `pendingArrivalEvents` selector:

| Boundary | Public state tuple | Authority / transition rule |
|---|---|---|
| Ingress fact | `P = { channelID (port scope), revision, key, rowID, seq }` | `revision` is a channel-local monotone journal revision. For `request`/`final`, `key` is the canonical root turn identity and `rowID` is the materialized root identity; for a readable standalone `event`, both are the envelope identity. `seq` is the accepted Replica ingress sequence. |
| Timeline journal | `J = { revision, acknowledgedRevision, events: P[] }` | Only `state.arrivalReceipts` exposes this snapshot. A consumer token prevents detach/remount from acknowledging. `timeline()` returns the ordered hot/overflow suffix; `dispatch({ type: 'live-arrival.acknowledge-timeline', throughRevision })` is the only journal acknowledgement authority. |
| Reading bridge | `B = { ...J, events: liveEvents + durableEvents }` | [`useTimelineArrivalReceipt`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useLiveArrivalReceipts.js:14) records the journal events and restores durable records. A restored record has `revision: 0`, `durable: true`, `key`, `rowID: key`, and `seq`; this is an explicit durable replay marker, not a new live revision. |
| Durable Reading fact | `D = { channel/view ownership, CAS revision, mode, unseenTail, unseenKeys, unseenRecords: [key, maxSeq][] }` | [`view-session`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/view-session.js:50) canonicalizes every record by stable key and maximum finite positive sequence. Writes require the active `(channelID, viewKey, activationID, expectedRevision)`; `readActiveReadingUnseen(channelID)` returns a channel aggregate over active views. |
| Acknowledgement | `A_t = { type, throughRevision }`; durable clear returns `{ records, remaining }` | The typed command constructors are the only public journal command values ([`live-arrivals.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/live-arrivals.js:1)). `useTimelineArrivalReceipt.acknowledge` dispatches the timeline command and then clears active durable records; the two clocks remain distinct. |

The journal `revision`, Replica `seq`, and view-session CAS `revision` are
different clocks. A current consumer may compare a journal revision only with
the journal's `acknowledgedRevision`; it must not treat a durable CAS revision
or a physical sequence as an arrival-event index.

## Minimal public contract

For the current user capability (“do not lose a viewport-notifiable live
arrival; retain it through remount; clear it only after exact visible
acknowledgement”), the contract is:

1. A qualifying live commit creates exactly one journal fact with a positive
   monotone `revision`, stable `key`/`rowID`, and positive `seq`.
2. Detach/remount never acknowledges an undisposed journal fact. A typed
   through-revision command can clear only the prefix up to the journal's
   current monotone boundary.
3. A browsing view receives durable unseen facts by stable key and retains the
   maximum finite `seq` for that key. Repeated events for the same root are
   one durable identity with the latest sequence, not a replayable list of
   every collapsed row identity.
4. The visible reader may acknowledge the journal and durable record together
   only through the current public bridge; no renderer may mutate either
   store directly.

The direct current evidence is:

- [`live-timeline-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-timeline-arrivals.test.js:31) proves detach/remount retention, channel isolation, unwatched behavior, and typed prefix acknowledgement.
- [`live-presentation-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-presentation-arrivals.test.js:19) proves the separate presentation journal, source-revision slicing, and stable-root plus exact-envelope IDs.
- [`view-session.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/view-session.test.js:77) proves durable stable identities are retained and normalized rather than bounded by the retired key-only limit.
- Existing large-window owner evidence in [`blocked-round21-public-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/blocked-round21-public-owner.test.jsx:300) proves the same journal owner preserves the exact ordered window and repeated root identity across overflow/partial acknowledgement.

## SZ-149 disposition

The historical case at
`fae8b70:tests/timeline-reading-integration.test.jsx:66-76` asked a private
`pendingArrivalEvents` helper to select every newer event from a sparse prefix
with synthetic collapsed `rowIDs`. No current public port exposes that
per-event suffix or promises that each collapsed row identity is a separate
user-visible unread fact. The current owner deliberately publishes the typed
journal plus durable stable-key/max-sequence contract above.

Therefore SZ149 remains **OPEN / product-owner handoff**, with the owner and
minimal current contract now explicit. Closing it would require a product
decision about per-event collapsed identities; adding a selector, a second
store, or a compatibility parser would violate the current ownership boundary.

## Verification

Focused command:

```text
npx vitest run tests/live-timeline-arrivals.test.js \
  tests/live-presentation-arrivals.test.js \
  tests/view-session.test.js --reporter=dot
```

Result: **3 files passed; 13 tests passed**. No product source was modified in
this round.
