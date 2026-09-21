# SZ-100..103 Reading/history public-owner migration

Reviewed base: `75a9f4a` (`refactor/frontend-subtractive-cleanup`).
Baseline source: `c83bb6f` (`tests/timeline-channel-switch.test.jsx`), with the
four assigned cases removed by `faadffb`. This report keeps the cases separate;
the shared fixture does not merge their observables.

Scope is tests and audit only. No `src/`, backend, protocol, vendor, package,
lockfile, or compatibility boundary changed.

## Current owner

The single current user-facing chain is:

`WorkspaceApp → useConversationProjection → useBrowsingReadingController → useHistoryConsumer → history.request`

`useConversationProjection` exposes the immutable Presentation rows and the
typed Reading viewport port. `useBrowsingReadingController.reportDomEvidence`
is the public physical evidence boundary; it admits a viewport-underfill
demand only after the current Presentation, attach, message-current, bottom,
and `hasOlder` facts are present. The test uses the canonical
`createChannelReplicaStore` only to construct a normal Replica-shaped fixture;
it does not inspect or create a second production authority.

## Case ledger

| Case | Baseline action and observable | User capability | Invariant | Current public evidence | Disposition |
|---|---|---|---|---|---|
| SZ-100 | Render four visible timeline rows with `buffered: 0`; rerender with `buffered: 5_000`; visible row count stays unchanged and no “查看更早动态” button exists. | Background history preparation must not move or silently grow the visible list, and users are not offered a retired manual-load affordance. | Reservoir/cache supply is separate from Presentation; one Reading/history consumer owns release. | `sz100-103-reading-history-public-owner.test.jsx` rerenders the same canonical state through `useConversationProjection`, proves identical public Presentation IDs/count, proves no request, and proves no `loadOlder` action exists on either viewport or status. Existing real-App TC0210 also checks reservoir silence/no button. | **PASS** |
| SZ-101 | Construct the old test port with scheduler facts under `status` and `loadOlder` as a top-level action; assert the two locations remain separate. | A consumer can read lifecycle facts without treating them as commands; history actions remain typed public capabilities. | Status is an observation projection; command methods belong to the Reading viewport port, not a mirrored status object. | The successor reads `viewport.status` for `attached/hasOlder/buffered`, rejects `onAtTop/onNearTop/onUnderfill` there, and requires the public typed `onAtTop/onNearTop/onUnderfill` methods. The retired `loadOlder` name is not restored. | **PASS** |
| SZ-102 | Render a short first screen at the top with `attached/messageCurrent/hasOlder` and buffered supply; automatic lifecycle calls `loadOlder` once with the first-row anchor. | When the current short viewport is already at its top boundary, available older supply is released without a manual button. | Physical viewport evidence is admitted once by Reading and becomes one bounded semantic history demand; reservoir growth itself is not Presentation publication. | The successor sends typed `viewport-coverage` evidence through `useBrowsingReadingController.reportDomEvidence`; it proves exactly one existing `history.request` with `reason: underfill` and `urgency: anticipatory`. No diagnostic event is used as the oracle. Existing real-App TC0211 covers user upward runway release. | **PASS** |
| SZ-103 | Start with `attached: false, hasOlder: false`; initial short viewport must not call `loadOlder`; after authoritative attach publishes `hasOlder: true`, the same viewport creates one demand. | A short viewport must not guess that older history exists before attach authority; once the server publishes that fact, the consumer must resume. | Demand admission is gated by current attach/message/bottom/`hasOlder` facts, not by an initial zero range or cached false. | The successor proves cold `viewport-coverage` returns false and sends no request; after the same public owner receives generation/attach/message-current/`hasOlder`, the same typed evidence returns true and sends one `underfill` request. | **PASS** |

## Verification

Focused command:

```text
npm test -- --run tests/sz100-103-reading-history-public-owner.test.jsx --reporter=dot
```

Result: **1 file / 4 tests passed**.

Extended related-owner run (`history-demand`, Feed warm-cache/physical
operation, and this successor): **4 files / 26 tests passed**. Production build:
**passed** (`4306 modules`; existing large-chunk advisory only).

The existing browser owners remain separate evidence rather than being counted
as replacements for these four typed cases:

- `tests/browser/f7-history-water-baseline-0210-0211.spec.js` — real App
  background reservoir silence/no manual button and upward runway release.
- `tests/browser/f7-history-water-baseline-0217-0221.spec.js` — real App
  filtered/underfilled history progress and physical top evidence.
- `tests/channel-feed-runtime-warm-cache.test.jsx` — Feed-owned background
  warm coverage; it does not prove the public Reading status/action boundary.

No private reducer/cache implementation, diagnostic-only oracle, second store,
legacy `loadOlder` compatibility API, or frontend synchronous RPC/authority was
added. The four case rows remain individually inspectable in
`tests/sz100-103-reading-history-public-owner.test.jsx`.
