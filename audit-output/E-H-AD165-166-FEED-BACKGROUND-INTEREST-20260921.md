# E-H AD165/AD166 Feed background-interest closure

Base under review: `b9dbc9d356bbda84b13e9a96b4ef7487e79c80b2`.

This packet closes the two ChannelFeed lifecycle-interest cases without
introducing a second scheduler, store, compatibility path, or private export.
The only owner is the existing public `requestBackgroundInterest` command on
`ChannelFeedRuntime`.

## Case records

| Case | Old user action and observable | User capability / invariant | Current public owner and evidence | Result |
|---|---|---|---|---|
| AD-165 | The exact old setup was `fae8b70:tests/channel-feed-startup.test.jsx:512`: attach an empty `c0`, assert no `channelMeta`, invoke the public channel-entry refresh, then observe one fulfilled freshness revision and exactly one `channelMeta` call. The current ordinary-red successor is [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:432), whose current Feed observable is one `historyBefore` probe. | Channel entry owns one cancellable freshness obligation. Attach must not mint an implicit second probe; a caller receives a public lease and can release it. | [`createChannelFeedRuntime().requestBackgroundInterest`](../src/model/channel-feed-runtime.js:1701) is the sole owner. [`BACKGROUND_INTEREST_TYPES`](../src/model/channel-feed-runtime.js:30) now admits `channel-entry`; the successor asserts zero calls after attach, an accepted public lease, and one `historyBefore` call after the explicit entry request. This preserves the user-visible one-entry-freshness obligation while migrating its wire proof to the current Feed history owner. | **PASS / MIGRATE** |
| AD-166 | The exact old setup was `fae8b70:tests/channel-feed-startup.test.jsx:549`: enter while disconnected, resume once on the first attach, resume once on the next generation, ignore repeated grants, then produce one probe only on a hidden→visible transition and ignore duplicate visible notifications. The current ordinary-red successor is [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:447), which isolates the three lifecycle obligations at the current Feed owner. | Reconnect and foreground-return are separate lifecycle obligations, each with one Feed-owned cancellable probe. Repeated acquisition of the same intent/channel joins its existing lease; different lifecycle intents must not be collapsed into one obligation. | The same [`requestBackgroundInterest`](../src/model/channel-feed-runtime.js:1701) registry owns all three typed interests. The per-intent/channel key deduplicates leases; [`physicalOperationKey`](../src/model/channel-feed-runtime.js:1095) carries the background-interest key so the entry, reconnect, and foreground-return obligations each retain one observable probe. The successor asserts all three leases are accepted, a duplicate reconnect lease joins without a fourth call, and exactly three calls occur. | **PASS / MIGRATE** |

## Implementation boundary

`HISTORY_INTENT` now names `channel-entry`, `reconnect`, and
`foreground-return` alongside the existing search intent in
[`history-demand.js`](../src/model/history-demand.js:1). Feed admits those
values in its existing background-interest registry; no UI owner, second
store, or alternate history API was added.

The registry retains the existing bounded lease behavior:

- one `intent + channel` record and one `AbortController` are shared by
  repeated callers while that obligation is pending;
- releasing the last lease aborts the physical request and removes the record;
- a settled or failed request is removed, so a later lifecycle event may make
  one fresh attempt; there is no unbounded timer/retry loop;
- the physical key remains authority-fenced. Only background interests carry
  the per-obligation discriminator, so ordinary `loadHistory` callers keep
  their existing same-range join behavior.

## Verification

Focused commands on the independent worktree:

```text
npm exec vitest run tests/blocked-round26-public-owner.test.jsx -- -t 'AD-16[56]' --reporter=verbose
  2 passed, 18 skipped

npm exec vitest run tests/history-demand.test.js --reporter=dot
  5 passed

npm exec vitest run tests/channel-feed-runtime.test.jsx --reporter=dot
  26 passed

npm exec vitest run tests/channel-feed-runtime-physical-operation.test.jsx --reporter=dot
  13 passed

npm run test:browser -- tests/browser/f7-history-access-baseline-0227-0230.spec.js --grep 'TC0227' --reporter=list
  1 passed

npm run build
  built successfully
```

The browser smoke observed zero freshness frames during revoked access and
exactly one after the later grant. The focused AD165/AD166 run is the direct
proof for the new history-interest contract; the browser run is the real
production entry/reconnect guard. `git diff --check` is clean. Existing
Canvas/jsdom and Vite chunk-size warnings are non-failing diagnostics.
