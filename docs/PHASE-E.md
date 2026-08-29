# 阶段 E：空间治理、资源和自动化

状态：已完成
日期：2026-08-17
上位文档：[产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)
产品基线：[用户交互总规格](USER-INTERACTION-SPEC.md)

## 1. 阶段目标

阶段 E 的目标是：**在不建立旁路管理 API、不泄露设备密钥、不把本地记录伪造成服务端事实的前提下，完成空间配置、设备、频道资源、文件数据面、附件和定时动作的产品闭环。**

阶段 E 连续完成真实契约校准、产品设计、前端、Mock、单元测试和真实 Chromium 验收。这是当前 A–E 路线的最后施工阶段。

## 2. 真实后端入口

### 2.1 Registrar 消息面

- Actor 声明：`actor.template.register|edit|revoke|list`；
- 频道模板：`channel.template.register|edit|revoke|list|get`；
- 配置：`actor.overlay.set|clear`、`channel.profile.set`；
- 设备：`system.device.create|delete|attach|detach`；
- c0 使用 registrar seat，普通频道的频道内配置通过该频道 coreactor 转发；
- 所有结果仍以 RequestTurn terminal 为权威，OBS/运行状态是后续应用证据。

### 2.2 资源与文件

`resource` 是独立 WS 帧，闭集 op 为 `create|read|write|delete|stat|list`。KV 使用 `resource_id + args`；文件创建使用 `address + with_content`，此时 `resource_id` 可以为空。文件字节通过 `/files/{address}?t={ticket}` 的 PUT/GET 传输。

上传状态严格区分：票据已创建 → PUT 已完成 → 资源可再次读取。PUT 完成但登记未确认时不得重复上传。

### 2.3 定时动作

`after {channel_id,duration_ms,msg_type,payload}` 返回 `timer_id`；`cancel_timer` 返回同一 id。真实后端没有 timer list/OBS，因此界面只能显示当前浏览器保存的 timer id，并明确标注“本设备记录”。

### 2.4 设备安全

空间设备清单读取 `/obs/space/daemons`；当前频道的绑定、默认存储与在线事实读取 `/obs/channel/<id>/devices`，两者都不含 key。`system.device.create` 返回的 key 只在本次操作组件中展示一次；普通时间线、Mock 快照、截图基线和持久化均必须脱敏。真实 `system.device.list` 当前会序列化 key，产品禁止调用。

## 3. 信息架构

- 左栏账户区提供“空间管理”，进入 Actor 模板、频道模板、频道配置和设备；
- 频道标题提供“资源”和“定时动作”，右侧面板在名册、频道管理、资源和自动化之间切换；
- 空间级对象不占用普通消息编辑器；所有 registrar 写操作仍同步出现在中间账本；
- 文件上传后可“附加到消息”，消息中显示资源地址、文件名、类型、大小和下载入口；
- 后台操作卡展示上传、配置应用和定时动作的当前阶段，关闭面板不改变账本事实。

## 4. 后端缺口与诚实降级

- 没有安全 binding 列表：可执行 attach/detach 并查看 terminal/运行收敛，但不伪造完整绑定清单；
- 没有 timer observation：只保留本浏览器收到的 timer id；
- channel template 没有 OBS：通过 registrar `channel.template.list|get` 读取；
- class catalog 没有 Web 投影：Actor 声明 class/config 使用明确文本与 JSON，后端验证是最终权威；
- 文件托管依赖真实在线 daemon；Mock 可证明 UI 流程，真实路由、磁盘和 ticket 安全留作发布前 smoke。

## 5. 验收矩阵

| ID | 用户可见验收 | 自动证据 | 完成 |
|---|---|---|---|
| E-01 | Actor 模板可列出、登记、编辑、撤销，系统声明受保护 | unit + `E-BR-01` | ✓ |
| E-02 | 频道模板可列出、登记、编辑、查看、撤销 | Mock + `E-BR-02` | ✓ |
| E-03 | overlay set/clear 只作用于当前来源频道 | unit + `E-BR-03` | ✓ |
| E-04 | profile 描述、serving、endpoint 使用真实闭集 payload | unit + `E-BR-04` | ✓ |
| E-05 | 配置区分账本已完成与 OBS/运行状态已应用 | selector + `E-BR-04` | ✓ |
| E-06 | 设备列表只来自安全 OBS，不出现 key | contract + `E-BR-05` | ✓ |
| E-07 | mint/claim key 只展示一次且不持久化/不进截图基线 | unit + `E-BR-05` | ✓ |
| E-08 | attach/detach/retire 有影响说明、确认和 terminal | Mock + `E-BR-06` | ✓ |
| E-09 | KV create/read/write/stat/list/delete 完整闭环 | Mock + `E-BR-07` | ✓ |
| E-10 | resource list 不错误要求 resource_id | contract/unit | ✓ |
| E-11 | 文件 create ticket → PUT → read ticket → GET 闭环 | Mock + `E-BR-08` | ✓ |
| E-12 | ticket 过期可重新获取，上传后登记等待不重复 PUT | Mock + `E-BR-09` | ✓ |
| E-13 | 文件可作为附件进入消息并渲染资源卡 | `E-BR-10` | ✓ |
| E-14 | after/cancel_timer 使用真实字段并保留 timer_id | unit + `E-BR-11` | ✓ |
| E-15 | 定时动作明确标记本设备记录，刷新可恢复 | `E-BR-11` | ✓ |
| E-16 | 定时触发进入原频道账本，取消后不触发 | Mock + `E-BR-12` | ✓ |
| E-17 | 权限、冲突、ticket、资源和定时器错误保留上下文 | Mock + `E-BR-13` | ✓ |
| E-18 | 阶段 E Mock 场景可 reset、固定 seed、虚拟时间推进 | Mock tests | ✓ |
| E-19 | Manifest、BUILD-SPEC、TESTING、总文档同步 | static audit | ✓ |
| E-20 | 阶段 A–D 回归、E Chromium、生产构建和卫生门禁全通过 | `npm run test:all` | ✓ |

## 6. 完成门槛

E-01 至 E-20 必须全部有当前工作树证据。Mock 不可证明的设备 secret 生命周期、daemon 文件路由、磁盘持久化、真实 class config 和并发权限必须明确进入真实服务端 smoke，不能用 Mock 通过替代。

## 7. 完成审计（2026-08-17）

| 证据域 | 当前工作树证据 | 结论 |
|---|---|---|
| 真实契约 | Registrar 模板/overlay/profile/device 闭集、resource 六类 op、文件 ticket 与 after/cancel_timer 已对照相邻 atoll 源码；客户端与 Mock 同步校准 | 已证明 |
| 空间治理 | `space-administration.js`、空间管理四个区域及 `E-BR-01..04` 覆盖模板 CRUD、来源频道配置和账本/OBS 分层 | 已证明 |
| 设备安全 | daemon 仅读安全 OBS；mint/claim key 仅操作组件一次显示；renderer 与 feed-cache 双重脱敏；`E-BR-05/06` 覆盖确认与 terminal | 已证明 |
| 资源与文件 | KV 六类 op、list 无 resource_id、ticket PUT/GET、过期重取、一次性 PUT、附件卡与真实浏览器下载由 Mock/unit/`E-BR-07..10` 覆盖 | 已证明 |
| 定时动作 | timer_id 按 principal 本地保存并明确来源；虚拟时间触发原频道账本，取消不触发；unit/Mock/`E-BR-11/12` 覆盖 | 已证明 |
| 异常与恢复 | 治理拒绝、资源冲突、ticket 过期/重复、无权限和定时器不存在保留稳定上下文；`E-BR-09/13` 与 Mock 测试覆盖 | 已证明 |
| Manifest 与文档 | 30 项能力中 7 项阶段 E 能力均更新实现状态和 `E-BR`；DESIGN、BUILD-SPEC、TESTING、MOCK-DESIGN、总任务和总交互规格同步 | 已证明 |
| 自动化总门禁 | 30 个 Vitest 文件共 93 项；39 条 Chromium（阶段 E 9 条，覆盖 E-BR-01..13）；Vite production build 与卫生检查通过 | 已证明 |

施工和真实浏览器验收期间发现并修复了五类问题：resource list/file create 被错误要求 `resource_id`；Registrar 结构化结果仍可能显示 `value.key`；feed-cache 会持久化设备 key；一次性密钥 effect 缺少 feed 版本触发；设备安全说明在非空列表时消失。上述问题均有回归测试。

Mock 不能证明真实 daemon 路由、磁盘持久化、设备 key 在后端日志/数据库中的生命周期、binding 安全投影、真实 class config 和并发治理权限；这些项目已进入 TESTING 的真实服务端 smoke，不冒充阶段 E Mock 证据。

阶段 E 至此完成，A–E 产品交互路线全部完成。
