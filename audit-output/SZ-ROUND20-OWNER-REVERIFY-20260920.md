# S–Z round 20 owner re-verification

Date: 2026-09-20. This packet reviews twenty contracts without reviving a
retired module or claiming an implementation detail as a user capability. It
contains seventeen current S–Z OPEN rows and three priority product packets:
the UI-VIS-09 empty-process affordance and the two public Workspace pending
selection repros. The five S32 rows are revisited because the Waiting/Replica
boundary is the requested priority; SZ-281 is deliberately not repeated.

## Priority owner evidence

### UI-VIS-09: empty “查看过程” is closed at the existing row owner

The current public owner is `TimelineRowRenderer`:
`hasProcessSummary(turn)` admits `onOpen` only for an execution process (tool
or non-text stage). A completed request/answer with no process therefore has
no `查看过程` button; a real progress turn still exposes the button and opens
the detail owner. The direct renderer tests passed as part of the focused run,
and the real Chromium visual contract also passed:

```text
ATOLL_TEST_WEB_PORT=15520 ATOLL_TEST_MOCK_PORT=19940 \
  npx playwright test tests/browser/ui-visual.spec.js -g 'UI-VIS-09' \
  --reporter=line --output=test-results-tz-uivis09-r20

1 passed (5.0s)
```

This is current owner evidence, not a screenshot-threshold workaround. The
signed current Linux oracle is the existing `958x219` layout; no source or
snapshot was changed in this packet.

### Pending selection: two real Workspace product gaps remain handoff-only

`tests/blocked-round19-public-owner.test.jsx` is the current public rail
owner. The existing `it.fails` probes remain expected failures, not skipped
cases:

| Packet | User capability and invariant | Current public owner / exact repro | Disposition |
|---|---|---|---|
| AD-097 | A→B 未 commit 时反选 A；最新选择必须是唯一 pending owner。 | `WorkspaceLayout` rail, [`blocked-round19-public-owner.test.jsx:68`](../tests/blocked-round19-public-owner.test.jsx:68), clicks c1 then c0. | **PRODUCT RED / HANDOFF**: same-channel reselect returns before clearing the first pending target. |
| AD-105 | A→B→A 只交接最终目标；旧 pending 不能抢焦点或 terminal owner。 | `WorkspaceLayout` rail, [`blocked-round19-public-owner.test.jsx:105`](../tests/blocked-round19-public-owner.test.jsx:105), clicks c1 then c0. | **PRODUCT RED / HANDOFF**: the stale first pending remains the shell handoff state. |

No Workspace source was changed: the owner worktree is dirty and this packet
does not manufacture a second navigation owner. These two packets stay with
the Workspace product owner.

## Seventeen S–Z OPEN rows reviewed

The current central ledger remains `164 GREEN, 0 RED, 1 PARTIAL, 142 OPEN,
20 GAP, 3 BLOCKED`. Every row below remains OPEN; no old test was deleted,
skipped, renamed into compatibility coverage, or declared obsolete.

| Case | User capability / invariant | Current public owner check | Disposition |
|---|---|---|---|
| SZ-144 | Latest 只能来自 exact authority token，role 不应进入 geometry。 | `createConversationPresentation` publishes immutable row candidates, but no current public test proves that exact authority-token rule while excluding role from geometry. | **OPEN**; retain until a Presentation/Admission owner exports that exact contract. |
| SZ-148 | latest-role candidate 在 commit 后只发布一次。 | Current Presentation has one commit receipt, but no direct public successor proves a latest-role candidate is emitted exactly once after commit. | **OPEN**; retain rather than infer from unrelated candidate tests. |
| SZ-149 | 稀疏、稳定 key 折叠的 arrival prefix 中，每个 newer event 都被选中。 | `ConversationSurface`/`ReadingSession` are current presentation consumers, but the deleted timeline-reading integration contract has no one-to-one public case. | **OPEN**; Reading-boundary handoff, no old scheduler restoration. |
| SZ-150 | 只有生产 timeline 确认在最新端后才报告 read seq。 | Current Feed/Reading owners carry physical read state, but no direct public test proves that production timeline confirmation gates the reported read sequence. | **OPEN**; retain pending owner-level evidence. |
| SZ-151 | filtered tail 清除 exact visible notice，不推进 physical channel cursor。 | Current filtered projection and ConversationSurface expose the visible notice, but no direct public case proves exact filtered-tail clearing without advancing the physical cursor. | **OPEN**; retain. |
| SZ-152 | HistoryDemand current 时重试同一 fenced receipt，且不依赖 geometry 变化。 | `channel-feed-runtime` owns `historyDemand`, yet no current public repro proves this retry contract. | **OPEN**; retain at Feed/Reading boundary. |
| SZ-153 | rejected receipt 留在 ReadingSession，直到 Cursors exact-once 接收。 | `ReadingSession` and Feed expose receipt/cursor ports, but no direct successor proves the rejected-receipt retention contract. | **OPEN**; retain. |
| SZ-154 | rejected receipt 不能跨 generation 或 semantic-scope replacement。 | Generation and semantic-scope fences exist in current owners, but no one-to-one public test proves the rejection cannot cross either replacement. | **OPEN**; retain. |
| SZ-155 | unfiltered All 推进 physical read，并确认 exact current identity。 | Current Feed cursor owner can advance physical read state, but no direct public case proves the unfiltered-All identity contract. | **OPEN**; retain. |
| SZ-156 | old-generation DOM observation 不能推进 reattached cursor。 | Current Feed/Reading paths carry activation and generation facts, but no direct public case proves this stale-observation fence. | **OPEN**; retain. |
| SZ-157 | old activation 的 late observation 不能被 hook 改写成 current activation。 | Current `reading-session` rejects stale activation observations, but no public composition case proves the hook-level boundary. | **OPEN**; retain. |
| SZ-158 | aborted render 不能向 committed DOM 发布 candidate snapshot 或 markRead authority。 | Current history/presentation admission has aborted-candidate fences, but no direct user-surface case proves the full DOM/markRead invariant. | **OPEN**; retain; do not infer from unit-only Admission guards. |
| SZ-280 | matched live terminal 在 trim 后保持，直到 older in-flight page release。 | `createChannelReplicaStore` retains exact terminal closure, and the current Waiting projection is directly testable, but no current public owner proves the retired matched-live-terminal scheduler sequence. | **OPEN**; Waiting/Replica product handoff. |
| SZ-282 | bounded reservoir 按 newest-first drain across partial reveal segments。 | Current Replica/Waiting owner proves explicit lifecycle facts, not the retired bounded-reservoir reveal sequence. | **OPEN**; retain; no scheduler compatibility layer. |
| SZ-283 | concurrent live terminal 必须先于 buffered replay page 发布而 merge。 | Current Replica can merge terminal facts, but no direct public owner proves this publication ordering. | **OPEN**; retain as a product regression packet. |
| SZ-284 | IndexedDB pages 保持 terminal-before-request 顺序。 | Current cache/Replica owners expose readable pages, but no one-to-one public case proves this ordering. | **OPEN**; cache/Waiting handoff, no duplicate owner. |
| SZ-285 | cached terminal merge 进 already-materialized canonical request。 | Current Replica/Waiting projection can preserve an exact closure, but no current public case proves the cached-terminal merge under the retired scheduler contract. | **OPEN**; retain pending product ruling. |

The Waiting checks in this packet did confirm adjacent current semantics rather
than silently closing the five rows above: a canonical `agent.ask` with no
provisional remains out of Waiting, cached facts stay readable while controls
are hidden, controls return only when both tail and roster authority are
current, and terminal rows do not resurrect. Those are covered by
`src/ui/timeline/waiting-presentation.test.jsx`,
`tests/feature-waiting-controls.test.jsx`,
`tests/waiting-currentness-public.test.jsx`, and
`src/model/feature-tasks.test.js`; they do not prove the five retired scheduler
sequences.

## Verification

Focused owner run:

```text
npx vitest run \
  src/ui/timeline/progress-trail.test.jsx \
  tests/agent-answer-reply-gating.test.jsx \
  tests/agent-information-architecture.test.jsx \
  src/model/feature-tasks.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/waiting-currentness-public.test.jsx \
  src/ui/timeline/waiting-presentation.test.jsx \
  src/model/channel-replica-terminal-closure.test.jsx \
  tests/blocked-round19-public-owner.test.jsx --reporter=dot

9 files passed; 47 passed, 19 expected fail.
```

Presentation spot check:

```text
npx vitest run tests/timeline-presentation-identity.test.js \
  src/model/conversation-presentation-mine-rules.test.js \
  src/model/conversation-presentation-scope.test.js --reporter=dot

3 files passed; 34 passed.
```

The expected failures include the two selected Workspace handoffs above plus
the other pre-existing A–D evidence cases in that shared public-owner file;
they are not counted as recovered S–Z rows. This round changes only this audit
report; no product source, Workspace/Reading/Outbox/vendor/package/lockfile,
private export, skip, or compatibility layer was touched.
