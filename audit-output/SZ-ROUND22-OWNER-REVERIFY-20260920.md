# S–Z round 22 owner re-verification

Date: 2026-09-20
Scope: the next twenty S–Z open/regression contracts. This round contains the sixteen
ledger entries SZ-177–SZ-192 plus four independent VendorListExecutor observation
regression packets. No previously green case is counted again.

This is an evidence and hand-off packet. It does not change a Reading or Vendor owner,
claim an old module obsolete, add a compatibility path, or change the central ledger.

## Four real VendorListExecutor REDs

`VendorListExecutor` is the public DOM-observation owner. Its current observable is the
`reading-observation` fact sent through `reportDomEvidence` in
`src/ui/timeline/VendorListExecutor.jsx:237-265`; settlement is emitted only from the
position-restore fence at `:562-591`. The four cases below are mutually exclusive:
each has one user capability and one authority invariant. They are retained as product
REDs for the Reading/Vendor owner rather than being hidden by changing the test.

| packet | user capability and invariant | public owner / observable | reproduction and actual RED | disposition |
| --- | --- | --- | --- | --- |
| V-OBS-01 | After a downward wheel, `scrollend` may settle the current user-owned tail observation; the settled bookmark must retain both message and block identity. | `VendorListExecutor` → `reading-observation`; direct assertion `tests/reading-observation-settle.test.jsx:184`. | Expected `source=user`, `settled=true`, `atTail=true`, bookmark `{messageID:'tail', blockID:'block:tail'}`. Actual source/settlement/tail are correct, but the bookmark loses `blockID`. | **PRODUCT RED / hand off** |
| V-OBS-02 | A selection drag/autoscroll must not acquire following authority; the tail observation must remain a settled user observation in browsing mode. | `VendorListExecutor` input/observation path; direct assertion `tests/reading-observation-settle.test.jsx:215`. | Expected `{source:'user', settled:true, atTail:true}`. Actual `{source:'layout', settled:false, atTail:true}`. | **PRODUCT RED / hand off** |
| V-OBS-03 | An input-free layout arrival at the tail is non-authoritative; only the settled observation may be published to Reading. | `VendorListExecutor` scheduled DOM evidence; direct assertion `tests/reading-observation-settle.test.jsx:231`. | Expected `{source:'settled', settled:true, atTail:true}`. Actual `{source:'layout', settled:false, atTail:true}`. | **PRODUCT RED / hand off** |
| V-OBS-04 | When the Reading input epoch advances before `scrollend`, pending user authority must be rejected and the settled observation must be non-user-owned. | `VendorListExecutor` epoch carried in `reading-observation`; direct assertion `tests/reading-observation-settle.test.jsx:249`. | Expected `{source:'settled', settled:true, atTail:true}`. Actual `{source:'user', settled:true, atTail:true}`. | **PRODUCT RED / hand off** |

These are genuine behavior failures, not missing selectors: the suite also asserts the
resulting Reading mode and the owner receives the observation. The owner files were
already dirty in the shared worktree, so this round intentionally made no source or test
edit.

## Sixteen retained S–Z open contracts

Each row was checked against the current public owner named below. The owner exposes
related activation, generation, lease, notification, DOM, or retry facts, but no current
one-to-one public integration case proves the exact contract. Therefore each remains
**OPEN** rather than being called green or obsolete.

| case | user capability / invariant | current public owner and observable | disposition |
| --- | --- | --- | --- |
| SZ-177 | Replacing source A with B and back to A must not let the old durable acceptance restart the controller. | `view-session` / `reading-session` activation and durable-acceptance facts; no A→B→A integrated authority case. | **OPEN — hand off** |
| SZ-178 | A same-channel semantic view switch must reopen initialization supply for an uninstalled saved bookmark. | `view-session.activate` and `ConversationSurface` projection; no semantic-switch/bookmark-supply case. | **OPEN — hand off** |
| SZ-179 | Canceling a gen0 cache request after a gen1 source lease rendered must reacquire zero-row projection supply. | Feed/cache source-lease owner; no gen0/gen1 late-cancel zero-row projection case. | **OPEN — hand off** |
| SZ-180 | After an old request settles, source A→B→C may reacquire exactly once for current C. | `channel-feed-runtime` generation/current-channel owner; no A→B→C exact-once reacquisition case. | **OPEN — hand off** |
| SZ-181 | Local-only exhaustion satisfies the current supply obligation and reopens only after real source/cache progress. | Feed local/exhaustion facts; no local-only exhausted/reopen progress case. | **OPEN — hand off** |
| SZ-182 | A saved-bookmark gen0 result settling after gen1 source lease rendered must reacquire the same target. | History/presentation admission bookmark owner; no gen0/gen1 same-target reacquisition case. | **OPEN — hand off** |
| SZ-183 | A same-source supply advance followed by a late old attempt must revalidate the same immutable saved-bookmark target. | History consumer ownership tuple; no late-attempt immutable-target revalidation case. | **OPEN — hand off** |
| SZ-184 | Unmount cancels a saved-bookmark attempt; Retry replays that same immutable target. | `ReadingSession` cleanup and history-consumer retry owner; no unmount/retry same-target case. | **OPEN — hand off** |
| SZ-185 | A detached cache error keeps readable rows and exposes an independent typed Retry state. | Feed/cache error plus `ConversationSurface` status/retry owner; no detached-error/readable-rows case. | **OPEN — hand off** |
| SZ-186 | Fresh following shows cached projection immediately but cannot follow the tail before the Replica revision is consumed. | Feed following/cache and `ConversationSurface` authority; no cache-projection/tail-authorization case. | **OPEN — hand off** |
| SZ-187 | One backlog notification boundary is frozen until presented follow evidence exists before advancing. | Notification/Feed high-water and following owner; no frozen-boundary/presented-follow case. | **OPEN — hand off** |
| SZ-188 | Retry repeats the same frozen notification event even after Meta advances. | Feed notification high-water owner; no frozen-event retry-after-Meta case. | **OPEN — hand off** |
| SZ-189 | Browsing retains a rejected frozen notification; a newer backlog is born only at a fresh tail. | Notification/read owner plus browsing session; no rejected-frozen/new-backlog tail case. | **OPEN — hand off** |
| SZ-190 | Real scroll-up upgrades the same anticipatory history operation to visible interactive demand. | `useHistoryConsumer` and `history-demand` typed intent owner; no same-operation upgrade case. | **OPEN — hand off** |
| SZ-191 | Same-generation remote EOF closes only the old supply certificate; a later reservoir reopens the same visible obligation. | `channel-feed-runtime` generation/EOF/reservoir owner; no EOF-then-reservoir reopen case. | **OPEN — hand off** |
| SZ-192 | A viewport-budget change during an active supply attempt is handed to the DOM owner for settle-time revalidation. | `VendorListExecutor` and history-consumer DOM-budget handoff; no budget-change/settle revalidation case. | **OPEN — hand off** |

## Verification

Command:

```text
npx vitest run tests/history-demand.test.js tests/history-presentation-admission.test.js tests/reading-session-ports.test.js tests/live-presentation-arrivals.test.js tests/notification-state-contract.test.js tests/reading-observation-settle.test.jsx --reporter=dot
```

Result: **5 test files passed; 1 failed. 43 tests passed; 4 failed.** The five passing
files cover the current history-demand, presentation-admission, Reading ports, live
arrival, and notification-state owners. The four failures are exactly V-OBS-01 through
V-OBS-04 above, with no additional failure hidden by filtering.

Only this audit report is added by round 22. No `src/`, Vendor/Reading owner, package,
lockfile, or vendor dependency was modified.
