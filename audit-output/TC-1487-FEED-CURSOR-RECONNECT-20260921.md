# TC-1487 Feed cursor reconnect contract

Date: 2026-09-21  
Base: `6b321d7`  
Case: `tests/wire.test.js:253`, “uses a fresh cursor snapshot after reconnect”

## Case record

| Field | Contract |
|---|---|
| User capability | After a connection loss, the next attach resumes from the latest cursor snapshot rather than replaying the cursor captured by the old socket. |
| Invariant | The attach payload is sampled at each replacement socket's `open` event. The current principal/channel/world cursor is an input fact; a stale wire generation cannot supply the new attach's `since` value. |
| Public owner | `createWire` owns attach/resume framing; `useWireSession` supplies `since: resumeLocalReplica`; `ChannelFeedRuntime.resumeLocalReplica` supplies the current Feed/Replica snapshot. No second cursor store or transport owner is introduced. |
| Baseline setup/action/observable | Start with cursor `{c0: 2}`, open and attach, advance the public cursor to `9`, close the first socket, let reconnect create the second socket, and assert its attach payload contains `{c0: 9}` without entering incompatible state. |
| Current successor | Unit keeps the exact mutable-cursor seam. Browser successor starts the real app on `deep-history`, observes the initial empty attach, waits for the visible `c0.project` tail, drops the real mock connection, and observes the replacement attach carrying positive current cursors. |

## Verification

```text
npx vitest run tests/wire.test.js \
  -t 'uses a fresh cursor snapshot after reconnect' --reporter=verbose
Test Files  1 passed
Tests       1 passed | 17 skipped (18)
```

```text
ATOLL_TEST_WEB_PORT=16487 ATOLL_TEST_MOCK_PORT=18487 \
npx playwright test tests/browser/wire-reconnect-cursor.spec.js --reporter=line
1 passed (7.1s)
```

The Chromium test uses only the real production page, mock control `drop`,
WebSocket attach frames, and visible timeline content. It does not seed or
inspect localStorage, private Feed fields, or test-only exports. The browser
assertion intentionally requires monotone positive replacement cursors: the
reader may acknowledge additional rows between the drop request and the new
socket's `open` task, so an exact value would be a timing oracle rather than
the user-visible freshness contract.

```text
npm run build
✓ built
```

## Disposition

**ACCEPT / current owner proven.** The product implementation was already
present at the frozen base (`wire.js` samples `since()` on every socket open).
This commit adds the missing real-browser public-entry proof and this case
record only; no product source, package/lockfile, compatibility path, private
export, second scheduler, or second store changed.
