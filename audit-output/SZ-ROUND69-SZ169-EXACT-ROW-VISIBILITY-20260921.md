# SZ-169 exact-row Reading observation — 2026-09-21

## Claim and owner

SZ-169 is the user-visible contract that a committed arrival is not treated as
observed merely because a settled Reading paint exists. The exact arrival row
must be present in that paint before the Reading owner can acknowledge the
arrival. If the paint is settled but the exact row is absent, the user must
continue to see the unseen obligation and the arrival receipt must remain
pending.

The current public owner is split at the existing boundary: `ChannelReplica`
owns the public `state.arrivalReceipts.timeline()` journal, while
`useConversationProjection` owns the Reading viewport observation and its
acknowledgement decision. The test uses only those public ports; it does not
inspect Replica internals, a private hook state, or a second store.

## Evidence

`tests/sz169-exact-row-visibility.test.jsx` commits two historical rows, enters
public Reading browsing mode, then commits `hidden-turn` as one live arrival.
It sends a settled, visible, non-tail public observation whose hit-tested row
is `old-2`, while the committed presentation tail is `hidden-turn`. The test
proves all of the following through public values:

1. the committed row is present in the current Presentation;
2. the public arrival receipt is exactly `{ key: 'hidden-turn', rowID: 'hidden-turn', seq: 3 }`;
3. `viewport.onReadingObservation(...)` accepts the valid non-tail observation;
4. because `hidden-turn` is not among the observed row IDs,
   `viewport.tailCaughtUp.caughtUp` remains `false`;
5. `viewport.unseenNotice` remains `1` and the public receipt remains
   unacknowledged.

This is a distinct contract from the existing arrival accumulation/jump cases:
those cases prove receipt ordering and count accumulation, whereas SZ-169
proves exact-row visibility is required before observation can clear the
obligation.

## Result

Current-main base: `3675ae2fa5479e56a16b2b32e731a64f476d206d`.

Focused command:

```text
npm test -- --run tests/sz169-exact-row-visibility.test.jsx
```

Result: 1 file passed, 1 test passed. This is test-only evidence; no product,
vendor, package, lockfile, skip, compatibility, or private export changes were
made.

Decision: **ACCEPT / close SZ-169 evidence**.
