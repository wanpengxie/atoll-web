# Browser G–M Round 36 — J canonical `q_tail_append`

本轮只迁移 browser contract 与审计记录；没有修改 `mock/server.mjs`、`src/`、vendor 或
package 文件，也没有删 skip、降低断言或把旧 pulse 继续当作成功 oracle。

## 为什么旧 `pulse` 不是 J 的合法 oracle

`fae8b70` 的 `jump-latest-ownership.spec.js` 用 `POST /mock/control/action` 的
`type: "pulse"` 驱动浏览态新动态。当前 mock 的 pulse envelope 是
`mock.channel.pulse`，payload 带 `transient: true`。这不满足 canonical presentable
event 合同：`personConversationEventVisible()` 明确拒绝 transient event，Replica 因而
不会生成 viewport live-arrival receipt；Presentation 也把它当作 transient lifecycle
fact，而不是用户可读的 Timeline row。用它要求 `.timeline-jump-latest` 出现，会把
“不可呈现的 transport/demo pulse”误报成产品缺陷。

旧用户意图本身保留：用户已经在浏览态时，后台新内容不能把阅读位置拉到底；只有用户
点击新动态提示，当前 Reading owner 才能回到最新端，并将那一条新内容实际绘制出来。

## 迁移后的严格合同

`jump-latest-ownership.spec.js` 两个 append 路径均改为 fixture 已提供的
`type: "q_tail_append"`。该路径发布一个普通 `agent.ask` request 和带可读 text 的
completed response，具有稳定的 `request_id`，因此是 canonical presentable tail。

浏览态用例现在逐门断言：

1. append 后公开 timeline 仍为 `browsing`，物理 gap 大于 24，且 append 之前没有
   `scrollTo` writer；
2. `.timeline-jump-latest` 必须出现；
3. click 后只允许一个 root scroll writer，mode 变为 `following`，gap ≤ 1；
4. response 的 `request_id` 在 DOM 中恰好一个 row，且该 row `painted`、与 viewport
   相交、经 `elementFromPoint` 命中；不能用相邻 row 或最后一行代替目标 identity。

在 tail-following 用例中也使用 canonical append，保持没有 jump notice、仍 following、
物理 gap ≤ 1，并要求 canonical request row 物化一次。第三个 same-turn terminal 用例
保持原合同不变。

## Chromium 验证

使用 clean detached `601b285`（只带本轮测试 patch，独立 mock/web 端口）：

```text
ATOLL_TEST_WEB_PORT=15438 ATOLL_TEST_MOCK_PORT=19138 npx playwright test \
  tests/browser/jump-latest-ownership.spec.js \
  --grep "browsing reader jump-latest" --repeat-each=5 --workers=1
```

结果：**5/5 PASS（32.6s）**。

随后在最新 clean HEAD `7fe66c4`（包含并行 owner 的 round36 evidence-normalization，
J 相关产品路径未变）以独立端口 `15442/19142` 重跑同一 browsing case：
**5/5 PASS（27.2s）**；该 HEAD 的整份 jump spec 另以 `15443/19143` 跑得
**3/3 PASS（14.9s）**。

追加复验：tail-following canonical append **5/5 PASS（26.9s）**；整份 jump spec
（三个 case）**3/3 PASS（18.6s）**。没有改 product/mock，临时 clean worktree 与服务已
清理。共享树其他 dirty 文件不属于本轮。

唯一 owner 结论仍是 Reading live-arrival/unseen/jump boundary 消费 canonical
presentable receipt；fixture 负责提供合法的 presentable input。Transient pulse 不得
成为该合同的替代输入。
