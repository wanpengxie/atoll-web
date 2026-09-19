# Waiting currentness public-composition audit

基线：`e7078a8`（ChannelFeedRuntime gates Waiting control currentness on
current-tail coverage and exact parent closure）+ `f6b6c24`（Workspace/Roster
routes the current roster authority into Waiting and control ports）。本轮只
新增公开组合测试，没有修改产品实现。

## 合同与owner

| 组合 | 用户能力/不变量 | 当前公开owner与证据 |
|---|---|---|
| cache-only rows | 可读缓存不能宣称当前 Waiting；公开Waiting组合不应出现 | `createChannelFeedRuntime().historyFor(channel).controlCurrent=false` until current-tail proof; `WorkspaceApp.waitingRosterAuthority.current` combines roster current and control current; `selectFeatureWaitingFacts` + `TasksFeature` are the public projection/render boundary |
| current tail + Roster authority | current tail and current roster actor authority jointly expose usable steer/interrupt controls | `historyFor().controlCurrent=true` after live request+queued rows close the exact parent range; `waitingRosterAuthority.current=true` and `actorIDs` contains the target; `TasksFeature` buttons are enabled and invoke the public command port |
| disconnect | disconnect invalidates feed control currentness and target control authority | `disconnectHistory()` clears `controlCurrent`/coverage; the same public Waiting item renders controls disabled and does not invoke the command |
| higher head | a re-admitted higher target head revokes the old tail proof until the new tail is covered | `setHistoryGrants(head_seq: 3)` clears the prior control proof even with the same generation; controls become disabled |

The independent executable is
`tests/waiting-currentness-public.test.jsx`. It creates only public runtime
rows, obtains the Waiting fact through `selectFeatureWaitingFacts`, supplies a
Roster-style `targetAuthority`, and renders `TasksFeature`; it does not read
private maps or React state.

## Verification

```text
npx vitest run tests/waiting-currentness-public.test.jsx --reporter=verbose

1 failed, 2 passed (3 tests)
RED: does not publish a cache-only Waiting combination before current-tail proof
  observed <strong>继续工作</strong> and the Waiting controls in TasksFeature
PASS: current tail + current Roster authority enables steer/interrupt
PASS: disconnect and higher-head revoke authority; controls are disabled and
      no command is invoked
```

The RED is intentional evidence, not an environment failure or a weakened
assertion. `ChannelFeedRuntime` correctly reports `controlCurrent=false` for
cache-only rows, but the current public projection still feeds those rows into
`selectFeatureWaitingFacts`, and `TasksFeature/WaitingRow` renders their
declared actions despite stale target authority (disabled rather than absent).
The product owner must decide/fix the cache-only presentation boundary; this
test does not hide that gap, add a compatibility path, or alter the current
owner.
