# fae8b70 顶层 Vitest N–R 当前 owner case ledger

基线：`fae8b7010afd1b3a950bc455ba6a577b65378cda`。本报告只覆盖
`tests/` 顶层、basename 属于 N–R 的 22 个 `*.test.js` / `*.test.jsx`；不含
`tests/browser/`。写报告时产品树检查点为 `a6bb317424829dfb3481a653c4d5a397850eea89`
（共享工作树可能继续由其他分区提交）。

## 计数、边界和裁决口径

- 基线精确为 **22 个 suite / 93 个 `it|test` 声明 / 98 个展开 case row**。98
  是把 `offline-app-shell` 的 4 个参数行和 `offline-recovery` 的 3 个参数行
  展开后的可执行数量；下表逐条处理 98/98，未处理 0。
- 本 agent 只编辑 `tests/` 与本报告；没有编辑 `src/`、`vendor/`、
  `package.json`、lockfile，也没有为测试导出 `useWireSession` 的
  `createSessionRoster`、恢复旧 store/API 或删除/skip case。
- `PASS/current` 表示当前公开 owner 直接保留合同并有定向证据；
  `COVERED/current` 表示同一用户能力已由新的公开 owner / browser owner 分层
  证明，旧实现细节不再复制；`ORACLE/current` 表示旧 case 只检查已删除的
  实现 seam，仍保留能力归属和证据边界，不把能力宣布 obsolete；
  `GAP-NRxx` / `BLOCKED-NRxx` 是需要产品 owner 或 root 决策的真实缺口。
- 当前公开 owner 的新增集中证据：
  `tests/n-r-public-owner-contracts.test.js`（通知、Replica、Reading、Composer
  和可见 actor）；`tests/roster.test.js`、
  `tests/roster-self-from-attach.test.js`（公开 `useChannelRoster`）；
  `tests/offline-recovery.test.jsx`（公开 Outbox 的 IndexedDB 重试）。已有
  `reading-container-handoff`、`reading-navigation-coordinator`、
  `reading-session-ports`、`resources`、`right-panel-file-reference`、
  `progress-trail` 替代证据一并列在下表。

## Suite contract records（C / I / O / S / F）

| ID | 基线 suite | 展开 cases | C：用户能力 | I：架构不变量 | O：当前公开 owner / evidence | S：baseline setup → action → result；current setup | F：当前事实 / 处置 |
|---|---|---:|---|---|---|---|---|
| NR01 | `node-update.test.js` | 4 | 用户能看到节点升级检查、重启反馈和失败状态 | 检查有认证、启动/重连/六小时边界，反馈留在同一控制入口 | 当前树没有 `src/model/node-update.js`、`useNodeUpdate` 或 WorkspaceApp 升级入口；无公开替代 owner | 旧 fake timer/client 驱动检查与重启；当前只能确认入口不存在，不能伪造 UI 通过 | 用户可见能力缺失；4 条 `BLOCKED-NR01`，交 root 决定后由产品 owner 建 owner，不恢复旧 module |
| NR02 | `notification-fallback.test.js` | 7 | 到底/可见/当前频道/过滤 scope 的未读徽标和 viewport 提示准确 | 读回执是事实；rail 与 viewport 分投影；相关与全部不混为一个聚合 | `notification-policy.js`（`readerCaughtUp`、`viewportUnseenNotice`、`notificationDisposition`）、`WorkspaceLayout` rail、`channel-feed-runtime.unreadFor`；`tests/notification-fallback`、`workspace-channel-rail`、browser notification specs | 旧 `projectChannelUnread(counts, channel, context)` 纯投影；当前从政策、rail、runtime 和真实入口验证，不恢复函数 | 4 个纯政策/徽标基础行为通过；弱 `total` / actor-filter 外部未读投影坍缩为同一个计数，见 `GAP-NR02` |
| NR03 | `obs.test.js` | 3 | OBS 只暴露仍存在的 membership/agent/device 观察面 | 退役端点不可被调用；频道/设备路径按协议编码 | `src/net/obs.js:createObsClient`；同名测试 | 同一 client 注入 fetch 并观察 endpoint 是否存在与 path；当前同公开 client | 3/3 `PASS/current` |
| NR04 | `offline-app-shell.test.jsx` | 6 | 已知成员离线可编辑/持久收稿但不能传输；拒权时缓存不可见 | durable acceptance 与 transport availability 分离；access boundary fail closed | `WorkspaceApp` access projection → `composerPermissions`；`tests/composer-access-permissions.test.js`、`WorkspaceApp` access placeholder / browser access evidence | 旧 `AppShell` + mock children；当前用实际 access object 形状和真实 access placeholder，结果仍检查三态、文案和隐藏缓存 | 6/6 `PASS/COVERED current`；未恢复 `AppShell` 或 mock private children |
| NR05 | `offline-recovery.test.jsx` | 8 | 离线编辑、draft 恢复/CAS、授权失效、附件 durable recovery 和 IndexedDB 重试 | draft/outbox 由同一 authority fence 写入；renderer-only URL 不得成为 durable truth | `Composer` / `useComposerSubmissionRuntime` / `outbox-store`；当前 `tests/offline-recovery.test.jsx` | 旧 Composer/useSubmissions；当前用 Composer public model、submission runtime、Outbox 和 fake IndexedDB，保留输入/写入/恢复结果 | 8 基线 row 通过；重试 row 已改为 public `createOutboxStore`，不再 import 删除的 `useSubmissions` |
| NR06 | `outbox-attachment-transaction.test.js` | 4 | 授权变化时发送/附件事务不泄露 transmitting 或复活 draft | 每次 awaited read 后重验 exact owner，单事务内保持 durable world 与 local attempt fence | `src/model/outbox-store.js` public store | 同一 four-case transaction harness 驱动 patch/accept/merge；当前同 API | 4/4 `PASS/current` |
| NR07 | `pane-resizer.test.jsx` | 3 | rail/context pane 可拖拽、键盘调整、双击恢复且受视口约束 | 只有一个几何 owner；提交宽度与 preview/resize 事件同一 authority | 当前 `WorkspaceLayout` 不渲染 resizer；只剩 CSS `.pane-resizer`，没有公开 component/owner | 旧 `PaneResizer` DOM + pointer/key/double-click；当前无真实入口可驱动 | 3 条 `BLOCKED-NR04`，产品能力缺失，未从 CSS 猜测通过 |
| NR08 | `pane-sizes.test.js` | 2 | pane 宽度在 reload 后可恢复，删除存储回 CSS 默认 | 单一持久化 width owner，viewport 上限与 rail/context 分离 | 当前无 `src/model/pane-sizes.js`、`usePaneSizes` 或 WorkspaceLayout width persistence | 旧 pure localStorage helper；当前无公开 width API | 2 条 `BLOCKED-NR05`，不得恢复旧 model |
| NR09 | `payload-abbreviate.test.js` | 5 | 移动端 tool 输出有界且可解释，非 tool 行不变 | 只在 tool process presentation 边界截断；不改原始 Replica row | 当前无 `src/model/payload-abbreviate.js`，TimelineRowRenderer 没有对应公开 abbreviation owner | 旧 pure object/string truncation fixture；当前没有 public mobile tool-output owner 可执行 | 5 条 `BLOCKED-NR06`，真实能力缺失，不能以删断言或 export 补齐 |
| NR10 | `progress-trail.test.jsx` | 5 | processing/settled trail 可读、可展开，text stage 成为正文 | 过程与最终正文分开；settled 不丢过程；空/单行布局稳定 | inline `ProgressTrail` in `TimelineRowRenderer.jsx`；`src/ui/timeline/progress-trail.test.jsx` | 旧 `ProgressTrail.jsx` drawer/JSON/timestamp/timer；当前渲染真实 row，保留 trail/settled/empty/one-line assertions | cases 2/3/5 `PASS/current`；case 1 缺 thinking drawer/JSON tree，case 4 缺 row time/live duration，均 `GAP-NR07` |
| NR11 | `reading-container-handoff.test.jsx` | 2 | following↔browsing 切换不重复 list，restore/visibility 正确 | 一个 `VendorListExecutor`，Reading owner 变化不创建第二棵 row tree | `ReadingContainerHandoff` → `VendorListExecutor`；同名 current tests | 旧 handoff wrapper；当前 rerender same stack/region，并检查 visibility/restore status | 2/2 `PASS/current` |
| NR12 | `reading-navigation-coordinator.test.js` | 10 | wheel/touch/key/pointer 交易有界、可取消、host/activation 不串 | 一个 input generation；native scrollend/quiet fallback 只结算当前 host | `createReadingNavigationCoordinator`；同名 tests | 旧 navigation host timing fixture；当前同公开 coordinator 输入/事件/clock | 10/10 `PASS/current` |
| NR13 | `reading-navigation-owner.test.jsx` | 7 | 物理 touch、following displacement、bookmark、selection autoscroll 的 Reading ownership | 输入潜势不夺权；有效 displacement 才产生 bookmark；epoch/host replacement 取消旧交易 | 当前 `ReadingSession` + `VendorListExecutor` + coordinator；`reading-observation-settle`、`message-list-lifecycle`、browser reading owner evidence | 旧 `ReadingNavigationOwner`/`useReadingNavigationHost` 已删；当前按 session/coordinator/list public ports 分层验证 | cases 1–6 为 `COVERED/current` 或 `ORACLE/current`；case 7 的 selection pointer owner 已不存在，列 `GAP-NR08`，不恢复 wrapper |
| NR14 | `reading-observation-settle.test.jsx` | 4 | scrollend/layout 采样只在同一 input epoch 下改变 following | source/settled/geometry/bookmark 与 input epoch 同步；layout 不能取得 user authority | `VendorListExecutor` `reportDomEvidence` → `useBrowsingReadingController` → `ReadingSession`; 同名 current test | 旧 MessageList mock；当前 fake Virtuoso +真实 VendorListExecutor/reading session | case 1 的 source/settlement/mode 通过，但当前 bookmark 缺少基线 `blockID`，列 `GAP-NR08`；cases 2–4 当前 source/settlement 与 baseline owner contract 分歧（selection/layout/stale epoch），均保留断言 |
| NR15 | `reading-session-admission-handle.test.jsx` | 6 | history admission 在 settle 后续期/反向取消/频道切换/重连时不持有退休句柄 | operation 绑定 activation/view/input/generation；新 owner 才能 settle/cancel | `history-presentation-admission.js`、`history-consumer-obligation.js`、`reading-session.js`；`reading-session-ports`、`history-presentation-admission`、`message-list-lifecycle` | 旧 `useReadingSession` handle；当前用 admission begin/observe/settle/validate、owner tuple 和 ReadingSession ports | 6/6 `COVERED/current`；旧 hook handle 是 implementation oracle，不恢复 hook/API |
| NR16 | `reply-target.test.js` | 2 | 终态消息可回复到 sender，缺席/self/system 不静默错投，parent/excerpt 保留 | 回复 delivery 必须绑定当前 roster；lost target 不 fallback 到 selected Agent | `composer-model.js` `resolveComposerDelivery`/`createMessageRequest`；`composer-model.test.js`、本分区 public owner test、`agent-answer-reply-gating` | 旧 `replyTargetOf/replyRecipient` pure adapter；当前从真实 Composer delivery 生成 typed batch，并保留 sourceId→parentId | case 1 `COVERED/current`（截断 excerpt 的旧 helper 是 ORACLE）；case 2 `COVERED/current`，self/system gating 由当前 message action/Composer owner 证据，不 export `beginReply` |
| NR17 | `request-owner.test.js` | 3 | revoke/regrant、world/attempt、awaited draft side-effect 不越权写入 | exact principal/access/world/attempt/draft fence 每阶段重验 | `src/model/request-owner.js`；同名 tests | 同一 capture/assess/execute owner facts 与 async effect | 3/3 `PASS/current` |
| NR18 | `resources.test.js` | 3 | 文件 list/create/read/delete/upload frame 合法，路径不越界，附件元数据安全 | attachment transaction 是 file resource 单一 owner；list 不伪造 resource_id | `useAttachmentTransactions` public port；当前 `tests/resources.test.jsx` | 旧 `src/model/resources.js` builders；当前 mount attachment transaction hook，观察实际 wire frame/metadata | 3/3 `PASS/current`；generic `kv:*` builder 无 current caller，旧 builder 行为保留为 `ORACLE/current`，不宣布产品 obsolete |
| NR19 | `right-panel-file-reference.test.jsx` | 3 | 绝对路径 Markdown 在 Atoll 内打开；嵌套 preview close=back；recent 可重开 | 当前 `ArtifactPreviewPanel`/`FilesFeature` 一个 preview stack owner；绝对路径不得落成 browser navigation | `ArtifactPreviewPanel` + `FilesFeature`；当前 replacement test | 旧 RightPanelHost/provider；当前直接渲染 WorkspaceRightPanel 实际 panel ports，检查 link/back/close/recent | absolute path case 是 `GAP-NR09`（现有 `it.fails` 保留）；nested/recent 2 条 `PASS/current` |
| NR20 | `roster-self-from-attach.test.js` | 4 | attach 后 roster 能立即显示，重连不重复，缺失/退休身份不复活 | attach producer token 与 channel owner fence；clear 必须移除退休 projection | `useChannelRoster` public hook → `RosterFeature`；本分区替代 test | 旧 `createSessionRoster.noteSelf/self/clearSelf` private store；当前 receive/seed/clearChannel 和 producer token，观察公开 rosters | 4/4 public publication rows 通过；旧 `self()` 直接映射是 `ORACLE/current`，没有为它导出私有 helper |
| NR21 | `roster.test.js` | 6 | 缓存 roster、完整 OBS authority、principal/self 识别、治理成功后刷新 | roster 只在当前 principal/channel/generation 的完整观察后 authoritative；治理 refresh 不依赖 system narration | `useChannelRoster`/`RosterFeature` public ports；本分区 replacement、`channel-access`/browser roster evidence | 旧 `src/model/roster.js` + private session store；当前 hook seed/refresh/receive/authority/clear，UI 只消费 rows/selfId | cases 1/2/5/6 `COVERED/current`；case 3/4 的 direct self/feed receipt 是 deleted store oracle，列 `ORACLE/current`，不恢复旧 store |
| NR22 | `roster-visibility.test.js` | 1 | roster 隐藏 system/genesis implementation actor，保留 human/business agent | 统一 visible actor predicate，RosterFeature 不另造过滤规则 | `src/model/actor-visibility.js:isVisibleActor` → `RosterFeature`；`actor-visibility.test.js` + public owner test | 旧 `visibleRosterRows` wrapper；当前直接过滤公开 actor projection | 1/1 `PASS/current` |

## 完整 case ledger（98 rows）

每行显式给出基线 setup/action/result（`S`）、当前 owner（`O`）、当前事实和处置（`F`）。同 suite 的 C/I/O/S/F 详见上表；这里不以 suite summary 代替 case 处置。

| case | baseline file / exact title | S：baseline → current observable | O：current public owner | F：current result / disposition |
|---|---|---|---|---|
| NR01-01 | `node-update.test.js` — checks every six hours while the page stays open | fake clock advances 6h → expect authenticated check | none; no update owner | `BLOCKED-NR01`: no current capability/entry |
| NR01-02 | `node-update.test.js` — uses the authenticated current-node endpoints | mock authenticated fetch → expect current-node endpoints | none | `BLOCKED-NR01`: endpoint owner absent |
| NR01-03 | `node-update.test.js` — checks on page startup and again after a node reconnect | mount/reconnect → expect two checks | none | `BLOCKED-NR01` |
| NR01-04 | `node-update.test.js` — keeps restart feedback in the same button | click restart → expect pending/success/error in same button | none | `BLOCKED-NR01` |
| NR02-01 | `notification-fallback.test.js` — 追平在场要四个条件同时成立 | four booleans true/false → `readerCaughtUp` | `notification-policy.js` | `PASS/current`; same assertions in current notification test/public-owner test |
| NR02-02 | `notification-fallback.test.js` — 视窗计数在追平时恒为 0，否则是真值 | unseen ± invalid → `viewportUnseenNotice` | `notification-policy.js` | `PASS/current` |
| NR02-03 | `notification-fallback.test.js` — 无过滤的全部视图追平后，活动频道的两格徽标都归零 | active/all/caughtUp over `{related:3,total:5}` → both zero | `channel-feed-runtime.unreadFor` + `WorkspaceLayout` | `GAP-NR02`: current runtime collapses weak/related projection; old pure `projectChannelUnread` is gone |
| NR02-04 | `notification-fallback.test.js` — @我视图只覆盖 related，过滤外 other 仍显示 | mine/caughtUp → related zero, other two | runtime notification projection + rail | `GAP-NR02`: current public runtime has no separate outside-filter total |
| NR02-05 | `notification-fallback.test.js` — actorFilter 不用聚合显示兜底掩盖过滤外真值 | actor filtered/caughtUp and not caughtUp → raw counts unchanged | runtime/rail | `GAP-NR02`: filtered raw truth is not preserved by current projection |
| NR02-06 | `notification-fallback.test.js` — 只清活动频道：别的频道与未追平时原样返回 | c1 or not caughtUp → original object | runtime/rail | `GAP-NR02`: no public equivalent of old context projector to prove both channel/filter boundaries |
| NR02-07 | `notification-fallback.test.js` — 追平时活动频道不再显示待同步占位 | pending true + caughtUp → pending/unknown false | `readerCaughtUp`/`viewportUnseenNotice` + rail pending state | `PASS/current`; pending/unknown placeholder behavior covered by current rail test |
| NR03-01 | `obs.test.js` — memberships 观察面已退役（成员清单随 attach 回执直接交付） | create OBS client → `spaceMemberships` undefined | `createObsClient` | `PASS/current` |
| NR03-02 | `obs.test.js` — 临时 agent-selection 端点已退役（值域走 describe，当前值走账本） | create client → `channelAgentSelection` undefined | `createObsClient` | `PASS/current` |
| NR03-03 | `obs.test.js` — 按频道读取绑定、在线和默认存储投影 | request `c0/work` → encoded `/obs/channel/c0%2Fwork/devices` | `createObsClient.channelDevices` | `PASS/current` |
| NR04-01 | `offline-app-shell.test.jsx` — separates known-member durable acceptance from transport availability | reconnecting member → editor/durable true, transmit false | `WorkspaceApp` access projection + `composerPermissions` | `PASS/current`; `tests/composer-access-permissions.test.js` |
| NR04-02 | `offline-app-shell.test.jsx` — does not grant durable acceptance for access=observer_active principal=root | observer active → all write false | same | `PASS/current` |
| NR04-03 | `offline-app-shell.test.jsx` — does not grant durable acceptance for access=access_denied principal=root | denied → all write false | same | `PASS/current` |
| NR04-04 | `offline-app-shell.test.jsx` — does not grant durable acceptance for access=loading principal=root | loading → all write false | same | `PASS/current` |
| NR04-05 | `offline-app-shell.test.jsx` — does not grant durable acceptance for access=member_active principal= | missing principal → all write false | same | `PASS/current` |
| NR04-06 | `offline-app-shell.test.jsx` — 撤权文案明确说明缓存内容已隐藏，不暗示仍可本地查看 | denied AppShell → status copy and hidden-cache sentence | `WorkspaceApp` public route / `ChannelAccessPlaceholder` user surface | `COVERED/current`; no AppShell import restored |
| NR05-01 | `offline-recovery.test.jsx` — keeps an offline member editor writable, accepts text locally, and disables live attachment entry | reconnecting Composer → local text accepted, file controls disabled | `Composer` + public composer model/runtime | `PASS/current` |
| NR05-02 | `offline-recovery.test.jsx` — does not expose a durable send seam for unknown principal | capabilities false → disabled editor/send | Composer public props/model | `PASS/current` |
| NR05-03 | `offline-recovery.test.jsx` — does not expose a durable send seam for read-only observer | read-only → disabled | same | `PASS/current` |
| NR05-04 | `offline-recovery.test.jsx` — does not expose a durable send seam for revoked member | revoked → disabled | same | `PASS/current` |
| NR05-05 | `offline-recovery.test.jsx` — retries a rejected IndexedDB open on the next explicit draft write without losing the dirty draft | first two `Outbox.writeDraft` opens fail, explicit retry succeeds | public `createOutboxStore` | `PASS/current`; migrated to explicit public indexedDBImpl, no useSubmissions |
| NR05-06 | `offline-recovery.test.jsx` — rejects renderer-only attachment URLs before any durable submission is inserted | blob URL submission → reject, restore empty | `outbox-store` durable submission gate | `PASS/current` |
| NR05-07 | `offline-recovery.test.jsx` — keeps a stable uploaded attachment while removing its renderer-only preview handle | resource id + blob preview → restore resource metadata only | `outbox-store` | `PASS/current` |
| NR05-08 | `offline-recovery.test.jsx` — never restores a local-only draft attachment as though its object URL were durable | draft with local + uploaded attachments → restore uploaded only | `outbox-store`/submission runtime | `PASS/current` |
| NR06-01 | `outbox-attachment-transaction.test.js` — does not expose a stale transmitting transition after authority changes during the record read | patch authorize false after read → queued remains | `outbox-store.patch` | `PASS/current` |
| NR06-02 | `outbox-attachment-transaction.test.js` — rechecks send authority after the awaited draft read and before bulkPut | accept draft second auth false → no submission, draft retained | `outbox-store.acceptDraft` | `PASS/current` |
| NR06-03 | `outbox-attachment-transaction.test.js` — merges into the latest durable text inside one authorized transaction | attachment merge after latest text → latest text retained | `outbox-store.mergeDraftAttachments` | `PASS/current` |
| NR06-04 | `outbox-attachment-transaction.test.js` — does not recreate a draft consumed after upload capture | consumed draft + late attachment → conflict | same | `PASS/current` |
| NR07-01 | `pane-resizer.test.jsx` — 向变宽方向拖动，逐帧回报并在松手时提交 | pointer drag → frame callbacks + commit | none | `BLOCKED-NR04` |
| NR07-02 | `pane-resizer.test.jsx` — 右侧面板向左拖变宽，并受视口上限约束 | right pane drag → max clamp | none | `BLOCKED-NR04` |
| NR07-03 | `pane-resizer.test.jsx` — 没有记忆宽度时从实际量出的宽度起步；方向键与双击 | mount/keyboard/double click → measured/reset width | none | `BLOCKED-NR04` |
| NR08-01 | `pane-sizes.test.js` — 左栏有固定上下限，右侧面板上限随视口给对话区留位 | pure width bounds → expected min/max | none | `BLOCKED-NR05` |
| NR08-02 | `pane-sizes.test.js` — 读写 localStorage，删除即回到 CSS 默认 | storage write/remove → persisted/default width | none | `BLOCKED-NR05` |
| NR09-01 | `payload-abbreviate.test.js` — 超过阈值就切,留下的是开头,并说清省了多少 | long tool process → prefix + saved count | none | `BLOCKED-NR06` |
| NR09-02 | `payload-abbreviate.test.js` — 恒不就地修改原行 | abbreviation → source row unchanged | none | `BLOCKED-NR06` |
| NR09-03 | `payload-abbreviate.test.js` — 没超阈值的原样返回,连复制都不做 | short tool process → same object/text | none | `BLOCKED-NR06` |
| NR09-04 | `payload-abbreviate.test.js` — 输出是对象时逐字段切 | object output → each field bounded | none | `BLOCKED-NR06` |
| NR09-05 | `payload-abbreviate.test.js` — 不是 tool 过程的行一律不动 | non-tool row → unchanged | none | `BLOCKED-NR06` |
| NR10-01 | `progress-trail.test.jsx` — 处理中：stage:text 显示为正文，工具与思考留在可展开的过程轨迹 | processing row → text answer + trail expand | inline `TimelineRowRenderer` progress trail | `GAP-NR07`: broad trail passes, old drawer/JSON details absent |
| NR10-02 | `progress-trail.test.jsx` — 落定后过程仍在：收成入口，展开是同一条轨迹 | terminal row → settled trail survives and expands | inline progress trail | `PASS/current` |
| NR10-03 | `progress-trail.test.jsx` — 没有文本的思考区间是状态不是记录：显示但点不开 | empty thinking → status row without detail button | inline progress trail | `PASS/current` (current behavior is no detail button) |
| NR10-04 | `progress-trail.test.jsx` — 运行气泡默认两行、整块展开，每行有时间且最后一行持续计时 | running trail → time rows + ticking duration | inline progress trail | `GAP-NR07`: rendered time/duration owner absent |
| NR10-05 | `progress-trail.test.jsx` — 运行气泡没有过程时只显示 header，一条过程时只占一行；完成记录不带时间 | empty/one/settled → header/line/no time | inline progress trail | `PASS/current` for surviving shape; timestamp detail separately `GAP-NR07` |
| NR11-01 | `reading-container-handoff.test.jsx` — keeps one inert outgoing paint only until browsing commits readiness | rerender mode → one active stack/list | `ReadingContainerHandoff`/`VendorListExecutor` | `PASS/current` |
| NR11-02 | `reading-container-handoff.test.jsx` — mounts a restored browsing session directly without duplicating the row tree | restorePending → status + one list + visibility callback | same | `PASS/current` |
| NR12-01 | `reading-navigation-coordinator.test.js` — groups a wheel burst into one generation and ends through the quiet fallback | wheel burst/quiet clock → one begin/end | coordinator | `PASS/current` |
| NR12-02 | `reading-navigation-coordinator.test.js` — does not keep later wheel bursts in the old generation | two separated bursts → two generations | coordinator | `PASS/current` |
| NR12-03 | `reading-navigation-coordinator.test.js` — uses native scrollend as an early wheel completion signal | wheel + scrollend → one early end | coordinator | `PASS/current` |
| NR12-04 | `reading-navigation-coordinator.test.js` — keeps touch momentum in one generation until scrollend or quiet after touchend | touch motion/end/scrollend → one transaction | coordinator | `PASS/current` |
| NR12-05 | `reading-navigation-coordinator.test.js` — ends an unsupported-scrollend touch after bounded quiet and ends a zero-motion cancel explicitly | touch quiet/cancel → bounded end/cancel | coordinator | `PASS/current` |
| NR12-06 | `reading-navigation-coordinator.test.js` — groups key repeat until keyup but splits a different navigation key | Arrow repeat/PageUp → grouped then split | coordinator | `PASS/current` |
| NR12-07 | `reading-navigation-coordinator.test.js` — updates a direction reversal without minting another generation | older→newer → update same generation | coordinator | `PASS/current` |
| NR12-08 | `reading-navigation-coordinator.test.js` — cancels an old activation and prevents its deadline from publishing an end | replace activation + clock → cancel only | coordinator | `PASS/current` |
| NR12-09 | `reading-navigation-coordinator.test.js` — rejects events from a replacement host with the same semantic role | host token mismatch → reject scroll | coordinator | `PASS/current` |
| NR12-10 | `reading-navigation-coordinator.test.js` — settles a pointer transaction through its cancellable quiet fallback | pointer/quiet → one end | coordinator | `PASS/current` |
| NR13-01 | `reading-navigation-owner.test.jsx` — routes an ordinary browsing touch sequence through one stable input generation | touch start/move/end → one input generation | coordinator + VendorListExecutor | `COVERED/current` by NR12/NR14 public owner evidence |
| NR13-02 | `reading-navigation-owner.test.jsx` — settles presentation on potential contact but defers bookmark capture until actual motion | touch potential/motion → prepare then bookmark | coordinator + ReadingSession | `COVERED/current`; old prepare/read callback itself is `ORACLE/current` |
| NR13-03 | `reading-navigation-owner.test.jsx` — keeps following input potential until native displacement supplies its bookmark | following wheel/scroll displacement → bookmark and browsing | VendorListExecutor + ReadingSession | `COVERED/current` through current single-list owner; no old following target port |
| NR13-04 | `reading-navigation-owner.test.jsx` — publishes the activating scroll and every later effective scroll in one following transaction | touch + repeated scroll → one transaction/revisions | coordinator + VendorListExecutor | `COVERED/current` / browser reading owner evidence |
| NR13-05 | `reading-navigation-owner.test.jsx` — ends touch ownership only when the tracked contact ends | two contacts → only tracked end settles | coordinator | `PASS/current` via coordinator touch contract |
| NR13-06 | `reading-navigation-owner.test.jsx` — cancels the captured transaction when another control advances the committed epoch | new session epoch → old transaction cancel | ReadingSession + coordinator | `COVERED/current` via lifecycle/ports |
| NR13-07 | `reading-navigation-owner.test.jsx` — keeps selection autoscroll in browsing evidence even when geometry moves newer | pointer selection + scroll → browse transaction | no selection-navigation public owner in current list | `GAP-NR08`: current VendorListExecutor does not publish this old selection owner contract |
| NR14-01 | `reading-observation-settle.test.jsx` — keeps current downward user authority when scrollend adds the settled sampling phase | wheel/scrollend/tail → user settled, following | VendorListExecutor → ReadingSession | `GAP-NR08`: source/settlement/mode pass and the rAF-before-observation timing remains asserted, but current bookmark omits baseline `blockID`; assertion retained |
| NR14-02 | `reading-observation-settle.test.jsx` — does not let selection autoscroll acquire following authority at the tail | selection + tail → browsing | same | `GAP-NR08`: current evidence source/layout differs from baseline and selection path is absent; assertion retained |
| NR14-03 | `reading-observation-settle.test.jsx` — keeps an input-free layout arrival at the tail non-authoritative | layout at tail → settled non-authoritative | same | `GAP-NR08`: current report source is layout/non-settled; no test weakening |
| NR14-04 | `reading-observation-settle.test.jsx` — rejects pending user authority after the reading input epoch advances | wheel then epoch advance → settled evidence must be stale | same | `GAP-NR08`: current evidence still reports user source after epoch advance though mode stays browsing |
| NR15-01 | `reading-session-admission-handle.test.jsx` — 请求 settle 之后继续向上输入仍然续期同一个 admission operation | settle → older input renew same op | history admission + obligation | `COVERED/current` |
| NR15-02 | `reading-session-admission-handle.test.jsx` — 请求 settle 之后反向输入仍然能取消同一个 admission operation | settle → reverse input cancel | history admission + ReadingSession | `COVERED/current` |
| NR15-03 | `reading-session-admission-handle.test.jsx` — 当前物理导航取消会撤销同代 awaiting-layout operation | navigation cancel → cancel current op | admission + coordinator | `COVERED/current` |
| NR15-04 | `reading-session-admission-handle.test.jsx` — content interactions 没有独立 Reading takeover 端口 | content interaction → no second takeover | one list / ReadingSession | `PASS/current` through one-list handoff/lifecycle |
| NR15-05 | `reading-session-admission-handle.test.jsx` — 切频道后新频道 native reverse input 只取消自己的 operation，不取得退休频道句柄 | channel switch/reverse → new owner only | admission exact owner tuple | `COVERED/current` |
| NR15-06 | `reading-session-admission-handle.test.jsx` — 重连 generation 后用户上滑不续期退休 generation 的 operation | reconnect generation → stale op not renewed | history status/generation + admission | `COVERED/current` |
| NR16-01 | `reply-target.test.js` — 从消息 sender 建立收件人与截断摘要 | sender/long body → reply target + recipient + excerpt | Composer delivery / `createMessageRequest` | `COVERED/current`; excerpt truncation helper is `ORACLE/current` |
| NR16-02 | `reply-target.test.js` — 自己、系统与已不在 roster 的 sender 不能成为回复目标 | self/system/missing sender → null/no fallback | current message action gating + Composer delivery | `COVERED/current`; no private `beginReply` export |
| NR17-01 | `request-owner.test.js` — rejects revoke/regrant access epochs instead of adopting current membership | old epoch/current member → reject | request-owner | `PASS/current` |
| NR17-02 | `request-owner.test.js` — keeps durable world and local attempt fences independent | attempt/world changes → distinct reject codes | request-owner | `PASS/current` |
| NR17-03 | `request-owner.test.js` — checks draft ownership again after an awaited side effect | draft changes during await → invalidation | request-owner | `PASS/current` |
| NR18-01 | `resources.test.js` — does not require resource_id for list | list frame → no resource_id | attachment transaction port | `PASS/current` |
| NR18-02 | `resources.test.js` — builds KV and file frames with separate control/data plane fields | builder list/KV/file → typed frame fields | attachment transaction port | `PASS/current` for file frame; generic KV branch `ORACLE/current` (no current caller) |
| NR18-03 | `resources.test.js` — rejects traversal paths and creates safe attachment metadata | `../../` + raw File → clamped path/safe metadata | attachment transaction port | `PASS/current` |
| NR19-01 | `right-panel-file-reference.test.jsx` — 绝对路径链接在 Atoll 里打开,恒不让浏览器去访问那条路径 | render Markdown artifact → intercept absolute path | ArtifactPreviewPanel / Markdown reference boundary | `GAP-NR09`; existing `it.fails` is the minimal repro |
| NR19-02 | `right-panel-file-reference.test.jsx` — 嵌套文件显示返回动作，关闭当前文件也使用同一返回语义 | nested preview → back and close both pop | ArtifactPreviewPanel preview stack | `PASS/current` |
| NR19-03 | `right-panel-file-reference.test.jsx` — 最近阅读面板可以直接重新打开文件 | recent row click → preview command | FilesFeature recent port | `PASS/current` |
| NR20-01 | `roster-self-from-attach.test.js` — noteSelf 之后 self() 立刻有值,不用先拉 roster 也不用先发言 | attach self note → immediate self | old private session roster | `ORACLE/current`; public receive/roster publication passes, direct self getter is not exported |
| NR20-02 | `roster-self-from-attach.test.js` — 重复记同一个不算变化——重连每次都会带这份清单过来 | duplicate attach → no semantic change | useChannelRoster producer projection | `PASS/current` for public projection; old return-value check `ORACLE/current` |
| NR20-03 | `roster-self-from-attach.test.js` — 缺频道或缺 actor 一律不记,空值比错值好 | missing channel/actor → no identity | useChannelRoster receive/clear | `COVERED/current` by public owner token/empty projection |
| NR20-04 | `roster-self-from-attach.test.js` — 被踢出频道时清掉,不留一个已经不成立的身份 | clear channel → empty rows | useChannelRoster.clearChannel | `PASS/current` |
| NR21-01 | `roster.test.js` — seeds the cached roster and self mapping before OBS is available | seed cache → rows/self available | useChannelRoster seed + Workspace access | `COVERED/current`; direct private self map `ORACLE/current` |
| NR21-02 | `roster.test.js` — marks only a complete network observation as authoritative for its principal and channel | incomplete/complete refresh → authority projection | useChannelRoster refresh/authority | `PASS/current` |
| NR21-03 | `roster.test.js` — does not mistake a missing principal field for the current human | no principal → no self match | Workspace roster public `selfId` / RosterFeature | `ORACLE/current`; current public UI does not expose session store getter |
| NR21-04 | `roster.test.js` — learns and persists self by matching receipt message id to feed sender | submission receipt → feed sender identity | old private session roster | `ORACLE/current`; no private helper import/export |
| NR21-05 | `roster.test.js` — 用公开的成员治理成功终态刷新名册，不依赖网页不可见的 system 叙事 | governance terminal/event → refresh actors | public `useChannelRoster.refresh` + governance port | `COVERED/current` |
| NR21-06 | `roster.test.js` — 成功终态到达后防抖重取 Actor OBS 并回报新成员 | completed governance → debounced OBS/new row | public refresh/Workspace roster owner | `COVERED/current`; debounce timing is old store oracle |
| NR22-01 | `roster-visibility.test.js` — hides standard actors while preserving humans and business agents | rows filter → root/steward only | `isVisibleActor` → RosterFeature | `PASS/current` |

## Product-regression packets

### GAP-NR01 / BLOCKED-NR01 — node update capability has no current owner

- Minimal reproduction: launch the current authenticated WorkspaceApp, inspect the
  rendered workspace and `src/app/WorkspaceApp.jsx`; no node-update check, current-node
  endpoint call, six-hour timer, reconnect check, or restart control is mounted.
- Baseline/current: fae8b70 had four cases around these user-visible operations; current
  tree has no `src/model/node-update.js` or equivalent public owner. This is not a stale
  selector/import failure because the capability entry itself is absent.
- First public owner boundary: authenticated WorkspaceApp feature graph; there is no
  current boundary to hand to a test. Root must decide whether the product capability
  remains required before a product owner adds it.
- Affected capability/invariant: node lifecycle feedback must be authenticated,
  time/reconnect scoped, and same-button owned. No compatibility module is introduced.

### GAP-NR02 — notification weak-total and filtered outside-scope projection collapsed

- Minimal reproduction: feed `channel-feed-runtime` a live public request addressed to
  another actor while the current principal is neither sender nor audience; call the
  public `unreadFor(channelId, selfId)`. Current result uses the same root set for both
  `related` and `total`, so `total` is zero instead of the weak all-message count.
- Baseline/current: old `projectChannelUnread` kept `related` and weak `total` distinct,
  and caught-up mine/actor-filter contexts only advanced their own boundary. Current
  `WorkspaceLayout` only renders the related badge and the runtime projection has no
  outside-filter count to preserve.
- First owner boundary: `src/model/channel-feed-runtime.js` `unreadFor()` / notification
  cursor projection, then `WorkspaceLayout` rail. The failing successor is
  `src/model/channel-feed-runtime-unread.test.jsx`; no selector or fixture is stale.
- Affected capability/invariant: user must not lose unrelated channel activity while
  acknowledging a filtered/related view; exact read receipts remain the source of truth.

### GAP-NR04 / GAP-NR05 / GAP-NR06 — pane geometry and mobile tool abbreviation owners absent

- Minimal reproduction: current `WorkspaceLayout` has no `.pane-resizer` element or width
  persistence owner; current TimelineRowRenderer emits process rows but no public
  abbreviation function/port. The old three pane-resizer, two pane-size, and five
  payload-abbreviate cases therefore cannot enter a current owner.
- Baseline/current: old components/models provided user-visible drag/keyboard/reset,
  persisted widths, and bounded tool output. Current CSS declarations alone do not
  provide behavior, and deleted modules have no callers.
- First owner boundary: `WorkspaceLayout`/context-pane feature graph for geometry;
  `TimelineRowRenderer` process presentation for tool output. These are product gaps,
  not stale imports. Root/product owner must decide and implement within the current
  single-owner architecture.

### GAP-NR07 — progress trail details/timing missing

- Minimal reproduction: render the current inline progress trail with a long thinking
  process and tool input/output. The broad trail expands, but rows have no detail drawer,
  JSON tree, rendered `<time>`, or ticking duration (`src/ui/timeline/progress-trail.test.jsx`).
- Baseline/current: fae8b70 opened thinking details and selectively expanded tool JSON,
  displayed per-row times and a live running duration. Current plain `<li>` rows retain
  process text only. The successor keeps the red assertions; it is not made green by
  removing the old checks.
- First owner boundary: inline `ProgressTrail` branch in `TimelineRowRenderer.jsx`.
  Capability/invariant: process detail remains user-readable, bounded, and separate
  from final answer. Product owner must add the UI at this owner.

### GAP-NR08 — selection/layout/epoch Reading evidence diverges

- Minimal reproduction: run `tests/reading-observation-settle.test.jsx` cases 2–4 against
  the current `VendorListExecutor`. Selection and input-free tail observations report
  `source: layout`/`settled: false`; after an input epoch advances, a user-sourced settled
  observation is still reported even though `ReadingSession` correctly remains browsing.
  The old selection navigation owner is also absent from the current single-list path.
- The same public-owner test's case 1 retains the baseline rAF timing check but shows that
  `VendorListExecutor`'s bookmark has `messageID`/row geometry without the baseline
  `blockID`; this is an additional reading-position evidence gap, not a selector failure.
- Baseline/current: fae8b70 required selection autoscroll to remain browsing evidence,
  layout tail arrival to be settled but non-authoritative, and stale user evidence to be
  rejected by epoch. Current mode safety is partly preserved, but evidence ownership and
  source/settlement contract are not equivalent.
- First owner boundary: `VendorListExecutor.observe`/`scheduleObserve` →
  `useBrowsingReadingController.reportDomEvidence` → `ReadingSession.observeReading`.
  No private owner is exported; product work must preserve one list executor.

### GAP-NR09 — absolute-path Markdown link is not intercepted

- Minimal reproduction: render `ArtifactPreviewPanel` exactly as the current workspace
  right panel does, with Markdown `[设计文档](/home/xiewanpeng/atoll/DESIGN.md:20)`. The
  link is a plain `_blank` link and click is not prevented; current test marks this
  `it.fails`.
- Baseline/current: baseline opened the reference in Atoll and never navigated the
  browser to the filesystem path. Current `WorkspaceApp` does not mount a
  `MarkdownFileReferenceProvider` around `ArtifactPreviewPanel`.
- First owner boundary: `ArtifactPreviewPanel` Markdown link renderer/provider boundary;
  nested back/close and recent file behavior still pass. Product owner must add the
  provider at this owner, not weaken the failing test.

## Focused verification and forbidden-boundary audit

Focused command (from `atoll-web`):

```text
npx vitest run \
  tests/n-r-public-owner-contracts.test.js tests/notification-fallback.test.js \
  tests/obs.test.js tests/offline-recovery.test.jsx \
  tests/outbox-attachment-transaction.test.js tests/reading-container-handoff.test.jsx \
  tests/reading-navigation-coordinator.test.js tests/reading-observation-settle.test.jsx \
  tests/reading-session-ports.test.js tests/request-owner.test.js tests/resources.test.jsx \
  tests/right-panel-file-reference.test.jsx tests/roster.test.js \
  tests/roster-self-from-attach.test.js src/ui/timeline/progress-trail.test.jsx \
  src/model/actor-visibility.test.js src/model/composer-model.test.js \
  --reporter=dot
```

Latest focused run after the public-owner rewrites: **17 files, 72 passed, 4 red
assertions in `reading-observation-settle.test.jsx`, 1 expected red `it.fails` in
`right-panel-file-reference.test.jsx`**. The three Reading reds are retained as
`GAP-NR08`; the right-panel red is retained as `GAP-NR09`. A broader supporting run also
included `tests/notification-state-contract.test.js` and showed two additional current
notification/arrival-policy reds (flat/canonical fixture and unconsumed presentation
receipt boundary); those are not silently counted as N–R baseline passes.

The roster replacements run independently as **2 files / 10 passed**; the public owner
contract file runs as **1 file / 5 passed**; offline recovery after adding the public
Outbox retry case runs as **1 file / 10 passed**. `channel-replica-turn-integrity`
contains an existing red terminal-conflict regression outside the 22 baseline suites;
it is not changed by this migration.

The staged diff for this delivery is restricted to the two roster tests, the offline
recovery test, the new public-owner test, and this audit report. No source/vendor/
package/lockfile path is part of this delivery; no private helper was exported and no
case was deleted or skipped.
