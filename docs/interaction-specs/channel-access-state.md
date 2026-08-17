# 频道访问状态交互规格

状态：规格基线
日期：2026-08-17
所属能力域：频道发现与访问状态
上级任务：[产品交互总任务](../PRODUCT-INTERACTION-MASTER-PLAN.md)
实现状态：阶段 B 已完成；显式 membership/self 投影与生产 Observer 仍是后端缺口

## 1. 用户目标

用户需要在任何时刻明确知道：

- 为什么一个频道会出现在界面中；
- 自己是否是频道成员；
- 是否可以读取频道账本；
- 是否可以发送消息或执行频道管理操作；
- 频道只是暂时不可用，还是已经退役；
- 权限、运行状态或连接状态变化后，下一步能做什么。

本规格的核心约束是：

> “空间中存在”“频道正在运行”“当前用户是成员”“当前连接能够读”“当前连接能够写”是五件不同的事，不能再由一个 `present` 或 `open` 布尔值代替。

## 2. 产品入口

频道访问状态会影响以下入口：

- 左侧“我的频道”；
- 左侧或独立页面中的“空间”；
- 频道标题栏；
- 中间时间线；
- 消息编辑器；
- 频道设置和管理入口；
- 频道旁观入口；
- 全局连接状态提示；
- 未读计数；
- 权限变化和频道退役提示。

## 3. 非目标

本规格不负责：

- 定义频道创建、退役的表单字段；
- 定义 Actor 管理的具体 UI；
- 决定公开旁观的最终后端政策；
- 新增 `/api/channels/*` 一类旁路接口；
- 把 OBS 中所有 present 频道都解释成“我的频道”；
- 用一次试探性写入制造账本记录来判断成员资格。

## 4. 后端事实

### 4.1 OBS space channels

`GET /obs/space/channels` 及其 `parent_id` 查询返回空间级频道树。

它能够回答：

- 频道是否出现在当前空间投影中；
- id、parent_id、name、qualified_name、type、status、owner_principal、created_at；
- actual measure 中的 `open`；
- Observation 是否 `complete`。

它不能回答：

- 当前 principal 是否是该频道成员；
- 当前 principal 在频道中的 human actor id；
- 当前连接是否通过 member 或 observer 路径读取 feed；
- 当前 principal 是否拥有写权限。

### 4.2 WS 成员订阅

WS attach 后，服务端自动为当前 principal 的成员频道建立 feed subscription。

该事实意味着：

- 客户端不需要逐频道 subscribe；
- 没有主动 observe 的情况下，收到某频道 feed 是成员关系的强证据；
- 但一个没有任何可见账本行的成员频道不会仅凭 feed 主动暴露自己；
- feed frame 本身没有标记 `member` 或 `observer`，客户端必须结合本地 observe 状态解释来源。

### 4.3 WS 写资格

submit、resolve、cancel、after、cancel_timer、resource 等业务帧只能在成员频道中执行。

典型结果：

- 成员且频道可用：业务 receipt；
- 已确认不是成员：`forbidden`；
- 资格查询、频道或 subject 暂不可用：`unavailable`；
- 频道不存在或已退役：可能表现为 `channel_not_found`、`channel_unavailable`，或后续投影消失。

一次成功业务 receipt 是成员可写关系的强证据，但不能把“写一次试试”当作正常的成员发现机制。

### 4.4 Observe

协议定义了 observe/unobserve 和 observe_ended，但当前生产 gateway 没有注入 Observer。

因此：

- 产品模型必须预留 observer；
- 当前正式产品不展示“可用的旁观按钮”；
- Mock 可以实现 observer 场景，用于提前验证状态模型；
- 只有真实后端装配 Observer 并明确政策后，才能开启旁观功能。

### 4.5 Lobby

最新 atoll 中：

- lobby 是注册大厅；
- root 不是 lobby 成员；
- lobby 中只有 guest human 以及标准系统 actor；
- lobby 只允许 principal.register 和 principal.login；
- 登录后的协作界面不应把 lobby 当作 root 的普通频道。

产品裁决：

- lobby 可以存在于空间结构中；
- lobby 不进入已登录用户的“我的频道”；
- 第一版空间浏览默认隐藏 lobby；
- 调试或系统管理视图可以显式显示，并标记“系统注册大厅，不可协作”；
- Mock 必须遵守 root 非 lobby 成员的事实。

## 5. 状态模型

频道访问状态由四个正交维度组成，最终再推导一个 UI 执行模式。

### 5.1 存在性 `existence`

| 值 | 含义 |
|---|---|
| `present` | 最新完整 OBS 投影确认频道存在且 status=present |
| `retired` | 已由退役操作、observe_ended(channel_retired) 或完整 OBS 收敛确认退役 |
| `unknown` | 尚未完成 OBS，或最近 OBS 不完整/失败，不能断言存在或退役 |

规则：

- `complete=false` 时，列表中缺失不能解释为 retired；
- OBS 请求失败时保留最后已知状态，并标记 stale；
- 只有完整投影缺失、明确退役终态或 `channel_retired` 才能进入 retired；
- retired 是本地 tombstone，可用于清除缓存和解释旧消息，但不继续显示为可协作频道。

### 5.2 运行状态 `runtime`

| 值 | 证据 |
|---|---|
| `open` | OBS actual measure `open=true` |
| `closed` | OBS actual measure `open=false` |
| `unknown` | measure 缺失、unknown、OBS stale 或请求失败 |

运行状态只说明频道 host 是否正在服务，不直接说明当前用户是否是成员。

### 5.3 用户关系 `relationship`

| 值 | 含义 |
|---|---|
| `member` | 当前 principal 是频道成员，拥有 subject actor 和业务写资格 |
| `observer` | 当前连接通过 observe 只读订阅该频道 |
| `discoverable` | 空间 OBS 可见，但没有成员或旁观证据 |
| `denied` | 最近一次明确权限判断拒绝访问，且没有更晚的成员证据 |
| `unknown` | 信息不足，不能断言上述任一关系 |

关系证据优先级从高到低：

1. 后端未来提供的显式 membership/subject 投影；
2. 当前会话成功的业务 receipt → member；
3. 没有本地 active observation 时收到 feed → member；
4. observe 返回 `now_member` → member；
5. observe receipt → observer；
6. 当前 observation 存在时收到 feed → observer；
7. 业务帧明确返回 `forbidden` → denied；
8. 仅在空间 OBS 出现 → discoverable；
9. 其余 → unknown。

证据更新规则：

- 新证据必须带本次 connection/session epoch，旧连接的 observer 状态不能自动沿用；
- `unavailable` 不能降级成 denied，因为查询失败不等于确认无权限；
- `forbidden` 不能覆盖更晚的 member receipt/feed；
- 关系变化必须清理与旧关系不兼容的状态，例如 observer → member 时结束 observation 标记；
- 本地持久化的 member 只能作为启动占位，不是当前会话的最终权限依据。

### 5.4 数据新鲜度 `freshness`

| 值 | 含义 |
|---|---|
| `fresh` | 当前连接或最近成功 OBS 已确认 |
| `stale` | 使用上次成功结果，当前刷新失败或连接断开 |
| `initial` | 尚未取得任何权威结果 |

freshness 不单独决定权限，但会影响 UI 是否允许高风险管理操作。

### 5.5 推导模式 `mode`

产品组件不直接自行组合四个维度，必须通过统一 selector 推导：

| mode | 推导条件 | 可读 | 可写 | 可管理 |
|---|---|---:|---:|---:|
| `member_active` | present + open + member + fresh | 是 | 是 | 按能力/权限 |
| `member_stale` | member + stale，且未确认 retired/closed | 仅本地缓存 | 否 | 否 |
| `member_unavailable` | member + closed/unknown，或业务返回 unavailable | 仅已有缓存 | 否 | 否 |
| `observer_active` | present + open + observer + fresh | 是 | 否 | 否 |
| `observer_stale` | observer + stale | 仅本地缓存 | 否 | 否 |
| `discoverable` | present + discoverable | 否 | 否 | 否 |
| `access_denied` | denied | 否 | 否 | 否 |
| `retired` | existence=retired | 仅旧缓存归档 | 否 | 否 |
| `loading` | initial/unknown 且尚在加载 | 否 | 否 | 否 |

额外规则：

- 全局 WS 未 attached 时，即使频道是 member_active，也临时按 member_stale 呈现；
- runtime=closed 时，绝不启用编辑器；
- relationship=observer 时，绝不发送任何业务帧；
- discoverable 频道只有在 Observer 正式启用后，才可能展示“旁观”入口；
- retired 频道从协作左栏移除，但可以在归档/最近访问中保留只读本地记录。

## 6. 统一状态对象

建议前端模型使用下面的逻辑结构；具体实现可以是 reducer、store 或普通对象。

```js
{
  channelId: '...',
  profile: {
    id: '...',
    parentId: '...',
    name: '...',
    qualifiedName: '...',
    type: 'group',
    ownerPrincipal: '...'
  },
  access: {
    existence: 'present|retired|unknown',
    runtime: 'open|closed|unknown',
    relationship: 'member|observer|discoverable|denied|unknown',
    freshness: 'fresh|stale|initial',
    mode: 'member_active|member_stale|member_unavailable|observer_active|observer_stale|discoverable|access_denied|retired|loading',
    selfActorId: '',
    source: 'membership|receipt|feed|observe|obs|error|cache',
    reason: '',
    observedAt: 0,
    sessionEpoch: ''
  },
  flags: {
    systemReserved: false,
    obsComplete: true,
    hasLocalHistory: false
  }
}
```

约束：

- `mode` 只能由 selector 计算，不能由多个组件分别写入；
- `selfActorId` 只有 relationship=member 时有业务意义；
- `source/reason` 用于调试和解释状态，不直接展示原始英文；
- UI 不根据“是否有消息”猜测频道是否存在；
- UI 不根据“频道在 OBS 中”猜测是否可写。

## 7. 状态事件与 reducer

建议所有来源先转换成产品事件，再更新频道状态。

### 7.1 事件闭集

```text
OBS_CHANNEL_SEEN
OBS_CHANNELS_COMPLETE
OBS_CHANNELS_PARTIAL
OBS_CHANNELS_FAILED
OBS_RUNTIME_CHANGED
WIRE_ATTACHED
WIRE_DISCONNECTED
MEMBERSHIP_CONFIRMED
MEMBERSHIP_REVOKED
FEED_RECEIVED
BUSINESS_RECEIPT
BUSINESS_FORBIDDEN
BUSINESS_UNAVAILABLE
OBSERVE_ACCEPTED
OBSERVE_NOW_MEMBER
OBSERVE_ENDED
CHANNEL_RETIRED
CHANNEL_CACHE_RESTORED
```

### 7.2 关键 reducer 规则

```text
OBS_CHANNEL_SEEN:
  existence = present
  runtime = measure(open)
  若 relationship 未知，则 relationship = discoverable

FEED_RECEIVED 且本地没有 active observation:
  relationship = member
  freshness = fresh

BUSINESS_RECEIPT:
  relationship = member
  freshness = fresh

BUSINESS_FORBIDDEN:
  relationship = denied
  清除当前可写状态

BUSINESS_UNAVAILABLE:
  保留 relationship
  mode → member_unavailable
  不得改为 denied

OBSERVE_ACCEPTED:
  relationship = observer
  freshness = fresh

OBSERVE_NOW_MEMBER:
  relationship = member

OBSERVE_ENDED(now_member):
  relationship = member

OBSERVE_ENDED(channel_retired):
  existence = retired

OBSERVE_ENDED(channel_unavailable/capability_unavailable):
  relationship 不升级
  observer 状态结束

WIRE_DISCONNECTED:
  freshness = stale
  禁止写入和管理

CHANNEL_RETIRED:
  existence = retired
  清除 member/observer 可执行状态
```

## 8. UI 行为矩阵

| mode | 左栏 | 时间线 | 编辑器 | 频道设置 | 主提示 |
|---|---|---|---|---|---|
| member_active | 我的频道，正常高亮 | 历史+实时 | 启用 | 按能力启用 | 无 |
| member_stale | 我的频道，断线标记 | 本地缓存 | 禁用 | 禁用 | 正在重连 |
| member_unavailable | 我的频道，异常标记 | 本地缓存 | 禁用 | 禁用 | 频道暂不可用 |
| observer_active | 空间/旁观，眼睛标记 | 历史+实时 | 不显示或只读提示 | 隐藏 | 正在旁观 |
| observer_stale | 旁观，断线标记 | 本地缓存 | 隐藏 | 隐藏 | 旁观连接已中断 |
| discoverable | 空间列表 | 不加载账本 | 隐藏 | 隐藏 | 无访问关系 |
| access_denied | 空间列表弱化或隐藏 | 不显示 | 隐藏 | 隐藏 | 无权访问 |
| retired | 从我的频道移除 | 可选本地归档 | 隐藏 | 隐藏 | 频道已退役 |
| loading | 骨架屏 | 骨架屏 | 禁用 | 禁用 | 正在确认访问状态 |

### 8.1 “我的频道”收录规则

收录：

- relationship=member；
- 当前会话收到非 observation 来源的 feed；
- 显式 membership 投影确认；
- 本地缓存中的历史 member，在当前会话确认前以 stale 占位展示。

不收录：

- 仅 OBS discoverable；
- observer；
- denied；
- retired；
- lobby 系统注册大厅。

### 8.2 “空间”收录规则

- 收录 OBS space channels 返回的 present 频道；
- 展示层级、open 状态和关系标记；
- complete=false 时显示“空间信息可能不完整”；
- 第一版默认隐藏 systemReserved 频道，例如 lobby；
- 不在空间列表直接展示可写编辑器。

### 8.3 编辑器启用规则

编辑器仅在以下条件全部满足时启用：

```text
mode == member_active
&& globalWireState == attached
&& selfActorId 已知或当前动作不依赖 self actor
&& 当前目标 Actor/能力可用
```

当前 self actor 尚未由后端显式提供时：

- 普通 submit 可以允许，并在 receipt/feed 后学习 selfActorId；
- 审批、取消、排除自己、精确未读等依赖 self 的操作保持受限；
- UI 必须明确是“身份仍在确认”，不能静默猜测。

## 9. 状态迁移场景

### 9.1 首次登录

```text
initial
  → OBS 返回空间频道：discoverable
  → membership 投影或成员 feed：member_active
  → lobby 仍为 systemReserved，不进入我的频道
```

若 c0 没有历史 feed，且后端没有 membership 投影：

- c0 只能保持 discoverable/unknown；
- 这是后端契约缺口，Mock 应显式暴露该问题，不能用伪造消息掩盖。

### 9.2 切换频道

- 切换只改变 active channel，不改变 relationship；
- 时间线必须读取目标 channel 独立 state；
- member_active 才启用编辑器；
- discoverable 不应展示另一个频道的旧时间线；
- 切换到 retired tombstone 时仅允许查看本地归档。

### 9.3 断线重连

```text
member_active
  → WIRE_DISCONNECTED
  → member_stale
  → WIRE_ATTACHED + membership/feed 确认
  → member_active
```

- 断线期间允许查看缓存；
- 禁止提交新业务动作；
- 重连 attach 使用当前 cursor；
- 本地 observer 状态不能默认视为已恢复，必须重新 observe。

### 9.4 成员资格撤销

理想路径：后端显式 membership 变化通知。

当前可观察路径：

- 后续业务帧返回 forbidden；
- 成员 feed 停止；
- OBS/成员投影刷新确认不再是成员。

产品行为：

- 立即禁用编辑器；
- 从“我的频道”移到“空间”或隐藏；
- 保留已缓存历史但标明“你已不再是成员”；
- 清除 selfActorId 的当前权威性；
- 不删除本地历史，除非另有隐私策略。

### 9.5 频道临时不可用

```text
member_active
  → open=false 或业务 unavailable
  → member_unavailable
  → open=true / 新成功 feed / receipt
  → member_active
```

- 不把 unavailable 解释为无权限；
- 不从“我的频道”移除；
- 提供刷新或等待恢复，不提供重新加入。

### 9.6 频道退役

证据：

- 当前用户执行 channel.retire 并收到成功终态；
- observe_ended reason=channel_retired；
- 完整 OBS 树刷新后频道消失；
- 后端未来提供明确 lifecycle 事件。

产品行为：

- 立即关闭编辑器和管理入口；
- 从“我的频道”移除；
- 清除未读；
- 取消该频道 pending UI 动作，并以“频道已退役”结束；
- feed cache 可作为本地归档保留；
- 不因一次 OBS 请求失败或 complete=false 误判退役。

### 9.7 Observer 转为成员

```text
observer_active
  → observe_ended(now_member) 或 observe 返回 now_member
  → member_active/member_unavailable
```

- 移除旁观标记；
- 重新按成员 reader 的 feed 语义处理；
- 编辑器只在 open + attached + self actor 条件满足后启用；
- cursor 必须保持单调，不因 reader 模式变化回退。

## 10. 错误与恢复策略

| 错误/事件 | 状态影响 | UI | 自动恢复 |
|---|---|---|---|
| `forbidden` | relationship→denied | 无权访问 | 刷新 membership/OBS |
| `unavailable` | 保留 relationship，mode→unavailable | 暂不可用 | 重连或用户重试 |
| `channel_not_found` | 等待 OBS/生命周期确认，可能 retired | 找不到频道 | 刷新完整频道树 |
| `channel_unavailable` | runtime→unknown/closed | 频道未在服务 | 等待 OBS open |
| `capability_unavailable` | 旁观能力不可用，不影响 membership | 当前不能旁观 | 不自动风暴重试 |
| `now_member` | relationship→member | 你已是成员 | 切换成员模式 |
| `observe_ended(channel_retired)` | existence→retired | 频道已退役 | 无 |
| WS close | freshness→stale | 正在重连 | 指数退避 |
| OBS 503 | freshness→stale | 状态可能过期 | 有界退避 |
| OBS complete=false | 不删除缺失频道 | 空间信息不完整 | 后续刷新 |

错误处理原则：

- 传输错误、查询失败和权限拒绝不能混为一类；
- 顶部全局错误不能代替频道级状态；
- error detail 可以折叠显示，但产品状态由 code 决定；
- 不允许组件收到任意 error 后自行把频道删除。

## 11. 本地持久化

允许持久化：

- feed cursor；
- read cursor；
- feed cache；
- 最后已知频道 profile；
- 最后已知 member 关系和 selfActorId，作为 stale 启动占位；
- retired tombstone 的最小信息。

禁止把以下本地值当作当前权威事实：

- 上一次会话的 observer 状态；
- 上一次会话的 open=true；
- 上一次成功发送推导出的当前写资格；
- 单次 OBS 不完整结果中的缺失频道；
- 旧 selfActorId 对重新加入后的新 human actor 仍有效。

建议所有持久化访问状态携带：

```text
observed_at
source
principal_id
contract_version
```

principal 变化或 contract version 不兼容时，不恢复访问权威状态。

## 12. Mock 规格

### 12.1 必备状态

Mock channel 至少包含：

```js
{
  id,
  parentId,
  name,
  qualifiedName,
  status: 'present|retired',
  open: true,
  systemReserved: false,
  members: Map<principalId, actorId>,
  observers: Set<sessionId>,
  actors: [],
  history: []
}
```

### 12.2 Feed 过滤规则

- attach 只自动推送 session principal 是 member 的频道；
- observer 只收到显式 observe 成功后的频道 feed；
- observer 不进入业务写资格；
- root session 不收到 lobby feed；
- unobserve 后立即停止该频道 observer feed；
- retire 后所有 member/observer feed 停止；
- membership revoke 后该 session 停止新 feed，写入返回 forbidden。

### 12.3 首批预设场景

#### `channel-member-active`

- root 是 c0 成员；
- c0 open=true；
- c0 有不同于其他频道的历史；
- 编辑器启用。

#### `channel-empty-member`

- root 是一个空频道成员；
- history 为空；
- 用于证明成员发现不能依赖已有 feed 行。

#### `space-discoverable-nonmember`

- 频道出现在 OBS；
- root 不是成员；
- 不自动推 feed；
- 编辑器不可用。

#### `lobby-reserved`

- lobby 出现在可选调试空间投影；
- members 只有 guest；
- root 不收到 feed，不能 submit；
- 普通协作左栏隐藏。

#### `channel-unavailable`

- root 是成员；
- open=false；
- 保留缓存时间线；
- 编辑器禁用；
- 写入返回 unavailable/channel_unavailable。

#### `membership-revoked`

- 启动时 root 是成员；
- 控制器撤销 membership；
- feed 停止；
- 后续写入 forbidden；
- UI 从我的频道移除或降级。

#### `channel-retired`

- 启动时频道 active；
- 控制器触发 retire；
- OBS 完整刷新后频道消失；
- UI 清除未读、关闭编辑器并保留本地归档。

#### `obs-partial`

- 第一次 OBS 返回多个频道且 complete=true；
- 第二次漏掉一个频道且 complete=false；
- UI 不得把漏掉的频道判为 retired。

#### `observer-active`

- 仅在测试 feature flag 下启用；
- observe receipt 后开始 feed；
- submit 返回 forbidden；
- unobserve 后停止 feed。

#### `observer-becomes-member`

- 初始 observer；
- Mock 添加 membership；
- 发送 observe_ended(now_member)；
- UI 切换到 member 模式。

### 12.4 Mock 控制口

```text
POST /mock/control/set-channel-open
POST /mock/control/revoke-membership
POST /mock/control/grant-membership
POST /mock/control/retire-channel
POST /mock/control/set-obs-complete
POST /mock/control/end-observation
POST /mock/control/drop-websocket
```

每个控制操作必须返回新的领域状态，方便测试失败时打印诊断。

## 13. 浏览器验收

### 13.1 首次登录与 lobby

1. 使用 root 登录。
2. “我的频道”出现 c0。
3. lobby 不出现在普通协作频道列表。
4. 打开调试空间视图时可看到 lobby，并标记为系统注册大厅。
5. root 不收到 lobby 的实时 feed。
6. root 不会看到 lobby 编辑器。

### 13.2 成员频道与空间频道

1. Mock 同时提供一个成员频道和一个非成员 discoverable 频道。
2. 成员频道进入“我的频道”，编辑器启用。
3. discoverable 频道只进入“空间”，编辑器不显示。
4. 两个频道的时间线不能混用。

### 13.3 空成员频道

1. Mock 提供一个没有任何历史行的成员频道。
2. 该频道仍进入“我的频道”。
3. 时间线显示空账提示。
4. 编辑器按 open/attached 状态启用。

此验收要求 Mock 提供显式 membership；在真实后端没有 membership 投影前，该场景记录为后端阻塞。

### 13.4 断线

1. 打开 member_active 频道。
2. 触发 drop-websocket。
3. 时间线继续显示本地缓存。
4. 编辑器立即禁用。
5. 左栏展示重连/陈旧状态。
6. 重连并确认 membership 后恢复编辑器。
7. feed 无重复、cursor 不回退。

### 13.5 权限撤销

1. 打开成员频道。
2. 触发 revoke-membership。
3. 后续新 feed 不再到达。
4. 下一次业务动作若已在途，返回 forbidden 并关联到原操作。
5. 编辑器关闭。
6. 频道不再以 active member 形式出现。
7. 已缓存历史保留并显示“你已不再是成员”。

### 13.6 临时不可用

1. 将成员频道 open 设置为 false。
2. 频道仍留在“我的频道”。
3. 时间线显示缓存。
4. 编辑器禁用并显示“频道暂不可用”。
5. 恢复 open=true 后，UI 刷新并恢复写入。

### 13.7 频道退役

1. 打开一个成员频道并制造未读。
2. 触发 retire-channel。
3. 编辑器立即关闭。
4. 未读清除。
5. 频道从“我的频道”移除。
6. 本地归档仍可查看。
7. OBS complete=false 时不得误触发同样行为。

### 13.8 Observer 预备验收

仅在 Mock feature flag 下：

1. 对 discoverable 频道执行 observe。
2. receipt 后进入 observer_active。
3. 收到历史和实时 feed。
4. 编辑器始终不可写。
5. unobserve 后停止实时 feed。
6. observe_ended(now_member) 后切换 member 模式。

## 14. 真实服务端最小验证

Mock 无法代替以下检查：

1. root attach 后只收到真实成员频道 feed；
2. root 不是 lobby 成员，不能在 lobby submit；
3. 业务 `forbidden` 与 resolver `unavailable` 不混淆；
4. channel host open/close 与 OBS actual measure 一致；
5. membership revoke 后 feed 在后端约束窗口内停止；
6. channel retire 后协作停止；
7. 如果未来启用 Observer，真实 reader visibility 与 observe_ended 原因符合规格。

这些检查适合放入定时或发布前的真实 atoll 冒烟测试，不要求日常前端开发启动服务端。

## 15. 后端阻塞与决策

### P0：显式 membership/subject 投影

没有显式投影时，Web 无法可靠发现“没有历史行的成员频道”，也无法在首次发言前可靠获得 selfActorId。

本规格要求后端最终提供：

```text
principal → channel_id → human_actor_id
```

建议优先评估一个“我的 memberships”OBS 投影，因为它同时解决频道集合和 self actor 映射，又不需要扫描所有频道名册。

### P0：Observer 产品政策

Observer 未生产装配。开启前必须决定：

- 哪些频道 discoverable 且可旁观；
- observer 可见哪些 message visibility；
- lobby 是否永远禁止旁观；
- 权限由 profile、endpoint 还是独立政策表达。

### P1：成员撤销通知

当前成员 feed 被停止时没有专门的 member_ended 下行帧。Web 可以在下一次 forbidden 或 membership 投影刷新后收敛，但体验存在延迟。

应评估显式 membership 变更投影或通知是否值得增加；在此之前，前端不得因“暂时没有 feed”自行判定撤销。

## 16. 阶段 B 实现证据

阶段 B 已按本规格完成当前后端边界内的施工：

1. `src/model/channel-access.js` 提供唯一 tracker、selector 和按 principal/version 持久化；
2. `mock/domain.mjs`、`mock/scenarios.mjs` 和 `mock/server.mjs` 分离 membership、频道生命周期、OBS complete 与 feed 投递资格；
3. `ChannelList`、`Timeline`、`Composer` 和 `App` 消费统一 mode，不再从 `present` 自行推导可写；
4. `first-login`、`multi-channel`、`permission-revoked`、`channel-retired`、`obs-partial`、`real-backend-shape` 覆盖关键正常与反例；
5. `tests/channel-access.test.js` 和 `tests/browser/phase-b.spec.js` 的 B-BR-01..04 覆盖分组、stale、unavailable、partial、撤权、退役和 self 未知；
6. Observer 状态保留在模型中，但生产未装配前没有产品操作入口；
7. 显式 membership/subject 投影仍按第 15 节作为真实后端缺口保留，前端没有用 Mock 扩展伪造生产能力。

## 17. 完成标准

本交互能力完成必须满足：

- 产品代码中存在唯一的频道访问状态 selector；
- 组件不再通过 `status==='present'` 自行推导可写；
- “我的频道”和“空间频道”来源明确分开；
- root 不会在协作左栏看到 lobby；
- 非成员频道不会启用编辑器；
- open=false、断线、unavailable、forbidden、retired 有不同 UI；
- OBS complete=false 不会误删频道；
- 空成员频道在有 membership 投影时可被发现；
- Mock attach 按 membership 过滤 feed；
- 至少覆盖本规格第 13 节全部非 Observer 浏览器验收；
- Observer 场景在 Mock 中可测试，但正式 UI 默认关闭；
- 与真实 atoll 源码和契约 fixture 的形态核对通过；真实运行时冒烟仍是发布前验证项；
- BUILD-SPEC、TESTING 和 Mock 不再声称 root 可以协作访问 lobby。
