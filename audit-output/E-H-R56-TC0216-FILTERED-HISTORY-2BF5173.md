# E–H R56 — TC0216 filtered-history older-match proof

Date: 2026-09-20
Base: `2bf517357eaf9e7b5a69e8a5d5cc2a172237b0a5`
Worktree: `/tmp/e-h-tc0216-2bf5173`
Scope: TC0216 only. TC0212 is not changed or rerun here.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

## Case ledger

| Case | User capability | Invariant | Current public owner and evidence | Disposition |
|---|---|---|---|---|
| TC0216 | After selecting the public `只看我与 Claude 的往来` filter, a user browsing at the physical top can continue reading history until older matching Claude rows are visible, even when nonmatching rows occupy several physical pages. | Feed/history owns physical page supply; the filtered Presentation must not treat a completed nonmatching page as semantic completion. A top continuation with no prepend must preserve the exact semantic first-row identity/sequence, must not invent a position writer, and must stop on a newer direction/owner. | Public filter and view spec: [`ConversationSurface.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx). Demand/continuation owner: [`useHistoryConsumer.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js). Physical page owner: [`channel-feed-runtime.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js). Semantic actor projection: [`conversation-presentation.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/conversation-presentation.js). Public browser action/assertions: [`f7-history-filter-old-content-0216.spec.js`](/tmp/e-h-tc0216-2bf5173/tests/browser/f7-history-filter-old-content-0216.spec.js). | **PASS / product repair accepted.** The existing consumer now continues only when the completed result's `firstVisibleSeq` and committed first row prove that the filtered projection did not prepend; real physical pages continue through the same owner. An accepted position-row lease remains required for a real prepend. |

The old case action is reproduced through the current public entry: reset
`deep-history-delayed/1731`; append two old Claude rows; append 320 unrelated
rows; append eight newer Claude rows; append 320 more unrelated rows with a
visible tail of 20; log in; click the public Claude filter; use native upward
wheel input at the physical top. The protected observable is the two old marker
rows in the public timeline, exactly two matching old rows, and a sequence gap
greater than one physical 128-row page. The test also requires that no
`.timeline-history-demand` foreground status remains after the rows arrive.

## First red and owner decision

On clean base `2bf5173`, the filter showed the newer Claude group but the old
markers never appeared after 120 native wheel steps. The list was at physical
top with `scrollTop=0`, `scrollHeight=1828`, and only Claude questions 1–7
were present. This was not a selector or fixture-only failure.

The Feed/history layer was supplying pages: the diagnostic witness showed
non-empty network completions advancing `beforeSeq` through
`2039→1911→1783→1655→1527→1399`, followed by a top page
`1399→1391`. The actor-filter projection correctly continued to expose the
existing Claude first row, but `useHistoryConsumer` stopped after the top page
because no matching row was prepended, so no position-row lease or
`historyAnchor` existed. Its continuation gate required one of those geometry
proofs and refused the next physical request. The first public divergence is
therefore the existing `useHistoryConsumer` continuation owner, not Feed
transport, Replica storage, or Reading.

The repair remains in that owner. For a sparse filtered page it records an
exact first-row ID/sequence and `result.firstVisibleSeq` equality as a
no-prepend proof. That proof permits continuation without fabricating an
anchor; it is fenced by the same channel/view/controller, browsing mode,
monotonic intent/input epoch, `hasOlder`, and `tailEvidence !== 'newer'` checks.
If a real prepend occurs, the existing position lease/history-anchor path is
still mandatory. A replacement owner or newer direction cancels the
continuation.

## Verification

Focused unit boundary and Feed ownership tests:

```text
npx vitest run tests/history-demand.test.js \
  tests/channel-feed-runtime.test.jsx \
  tests/channel-feed-runtime-physical-operation.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  --reporter=dot
4 files passed; 45 tests passed.
```

Public Chromium contract, three independent ports/workers:

```text
ATOLL_TEST_WEB_PORT=28170 ATOLL_TEST_MOCK_PORT=29170 npx playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (21.2s)

ATOLL_TEST_WEB_PORT=28171 ATOLL_TEST_MOCK_PORT=29171 npx playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (19.8s)

ATOLL_TEST_WEB_PORT=28172 ATOLL_TEST_MOCK_PORT=29172 npx playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (19.9s)
```

No vendor, package, lockfile, compatibility API, private export, skip, or
TC0212 file was changed.
