# AD167 Feed regrant acceptance

Date: 2026-09-21  
Base: `b9dbc9d356bbda84b13e9a96b4ef7487e79c80b2`  
Owner: `ChannelFeedRuntime` grant/authority fence; `useWireConnection` is the
existing attach-side caller of the public `refreshChannel` port.

## Case contract

| Field | Contract |
|---|---|
| User capability | Revoking the active channel must not issue a freshness `channel_meta` probe; a later grant must resume the outstanding freshness obligation exactly once. |
| Invariant | A probe is admitted only while its captured `(principalEpoch, worldEpoch, generation, attachEpoch)` is current and the channel remains in the current grant set. A late result from the retired authority resolves false and cannot publish access or history facts. |
| Public owner | `ChannelFeedRuntime.refreshChannel` and its public `channelMeta` wire port; the attach lifecycle invokes the same port after `setHistoryGrants`. No second scheduler/store is involved. |
| Observable | Public wire spy/frame trace: zero `channel_meta` frames while revoked, one grant-side frame, one successor socket, and a revoked in-flight probe resolves `false`. |

## Evidence

The existing public-owner unit contracts are all green on this frozen base:

```text
npx vitest run tests/blocked-round21-public-owner.test.jsx \
  tests/blocked-round22-public-owner.test.jsx \
  tests/blocked-round24-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx \
  -t '\\[AD-167\\]' --reporter=verbose
Test Files  4 passed
Tests       4 passed | 76 skipped (80)
```

The direct pending-interest authority model and Feed regrant lifecycle also
pass without private fields or exports:

```text
npx vitest run tests/sync-data-fuzz.test.js tests/channel-feed-runtime.test.jsx \
  -t 'fences revoked|regrant|disconnect and regrant|refreshChannel' --reporter=verbose
Test Files  2 passed
Tests       3 passed | 34 skipped (37)
```

The real Chromium contract passes on the production entry, including the
revoked quiet window, later grant, exact one grant-side frame, and successor
socket:

```text
npx playwright test tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  -g 'TC0227' --reporter=line
1 passed (13.5s)
```

The production bundle also builds:

```text
npm run build
✓ built in 4.36s
```

## Disposition

**ACCEPT.** No product source change is required on `b9dbc9d`; the existing
Feed authority fix is sufficient. This packet adds no compatibility path,
private export, test skip, scheduler, or store.
