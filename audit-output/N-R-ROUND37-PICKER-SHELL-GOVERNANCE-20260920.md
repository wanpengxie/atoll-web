# N–R Round 37：Files picker stale-error / mobile drawer / Governance public-chain audit

审计基线：当前 HEAD `9d00b72`，并以共享工作树中 Files/Shell 的 dirty candidate
复验（这些产品 dirty 不属于本轮交付）。本轮只在公开 owner 测试中补齐 Files
picker 的跨请求反例与 receipt fixture，并复验 Shell drawer 与 Governance；没有编辑
产品文件。

## 边界与执行合同

完整遵守 `docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`。新增 picker 组合经
`WorkspaceApp → Composer commands.pickChannelFile → WorkspaceFeatureOverlays`
公开链驱动：首个 picker 的旧 Files error 通过公开取消关闭，再从同一公开 command
port 发起第二个 request；没有手工 `runtime.bind`、私有 owner import、私有 export、
旧 store/API、删除或 skip。drawer 通过 `WorkspaceLayout` 公开打开按钮验证；Governance
使用公开 feature port 与真实 Chromium Workspace 链。

## 当前合同矩阵

| case / owner | 当前结果 | 裁决 | 首断点 / 证据 |
|---|---|---|---|
| stale global `files.error` 不得 settle 新 picker | 首次请求自身 refresh rejection 后关闭，再开第二请求；旧 `files.error` 不会提前 settle，第二次自身 rejection 才 resolve | **ACCEPT（当前 dirty receipt candidate）** | `tests/workspace-real-runtime-composition.test.jsx:624-671`，公开 `WorkspaceApp → Composer → picker` 组合通过；`WorkspaceFeatures` 仅消费带 request baseline 的 `refreshReceipt` |
| 当前 request 的 refresh rejection 必须 settle | `refreshDirectoryReceipt` rejection resolve 当前 picker，dialog 保留 | **ACCEPT** | 同文件 `:677-703`，公开 Workspace 组合通过 |
| current refresh receipt error settle + stale error ignored | 旧 `files.error` 不触发；receipt epoch 前进到 current settled/error 后 settle，错误 dialog 保留 | **ACCEPT** | `tests/workspace-file-picker.test.jsx` receipt case 通过 |
| mobile drawer focus trap | 打开后 close autofocus；last→Tab→first、first→Shift+Tab→last | **ACCEPT** | `tests/n-r-round35-shell-filter-notification.test.jsx:41-71`，公开 `WorkspaceLayout` |
| mobile drawer sibling inert / restore | drawer 标为 modal layer，`main.inert=true`；Escape 后 opener 恢复且 `main.inert=false` | **ACCEPT** | 同文件 `:54-88` |
| Registrar template list/get/body → recipe create | 真实浏览器公开链完成 list receipt、matching get/body，再 create canonical recipe | **ACCEPT** | `tests/browser/governance-template-wire-contract.spec.js`，Chromium 1/1 |
| Governance failed ledger terminal + retry affordance | public `creation.failed/error` 未呈现为失败终态；“创建失败”及 retry affordance 缺失 | **REJECT / 产品红** | `tests/blocked-round35-governance-public-owner.test.jsx:116-155`，progress 仍为“正在收敛”，首断言 `:152` |
| Existing Governance causal child / Shell navigation | 同名旧 child 不满足 convergence；ready child 走 `enterChannel`、不写 hash | **ACCEPT** | `tests/blocked-round35-governance-public-owner.test.jsx` 前两项通过 |

## 定向执行证据

### N–R picker / Shell / Governance / channel access

```text
npx vitest run \
  tests/workspace-real-runtime-composition.test.jsx \
  tests/workspace-file-picker.test.jsx \
  tests/n-r-round35-shell-filter-notification.test.jsx \
  tests/n-r-round34-picker-governance.test.jsx \
  tests/blocked-round35-governance-public-owner.test.jsx \
  tests/channel-access.test.js --reporter=dot

6 files, 30 passed, 1 failed, 31 total
RED: failed Governance terminal/retry contract (governance public owner :152)
```

The stale-error composition, current-refresh composition, receipt-error unit case, and
existing refresh-rejection case are green. `HTMLCanvasElement.getContext()` messages are
pre-existing jsdom warnings, not test failures.

### Real Chromium Governance chain

```text
npx playwright test tests/browser/governance-template-wire-contract.spec.js --reporter=line
1 passed
```

The browser chain uses the real Workspace/Registrar public wiring; it does not seed a
template row directly or inject a private runtime.

## Regression handoff

### Picker stale-error handoff

The public regression sequence sets a prior Files failure, opens picker request A, settles
A through its own refresh rejection, closes through the public dialog, and issues request B
through the public Composer command. On the current dirty candidate, B remains pending while
the old global `files.error` is still present and resolves only after B's own refresh
rejection. The receipt epoch/channel/device baseline is the observed correlation boundary;
the test does not accept a global error as a request result.

### Governance failed terminal

The public `ChannelCreateModal` receives a typed `creation` projection with
`failed: true,error`, but the rendered convergence remains “正在收敛” and has no retry
button. Keep this red until the public Governance owner exposes a failed terminal and an
enabled retry path; do not weaken the assertion to the local `role=alert` only.

##越界审计

本轮交付范围：

- `tests/workspace-real-runtime-composition.test.jsx`：公开 stale-error sequence 与当前
  typed receipt refresh rejection control；
- `tests/workspace-file-picker.test.jsx`：receipt epoch/error 公开 port 合同，保留旧
  global error 不得提前 settle 的断言；
- 本审计报告。

未改 `src/`、vendor、package manifest、lockfile；未导出私有 API，未恢复旧 owner，未
删/skip 失败 case。共享工作树中其它 agent 的 dirty source/test/report 不在本交付范围。
