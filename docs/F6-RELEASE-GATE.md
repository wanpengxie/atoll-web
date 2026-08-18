# F6 发布门禁与真实 Atoll Smoke

日期：2026-08-18  
状态：已完成

## 1. 自动化门禁

最终发布门禁统一使用：

```bash
npm run test:all
git diff --check
```

F6 另有三组专项证据：

- `tests/f6-tokens.test.js`：颜色字面量只存在于 `tokens.css`，正文语义色对工作区表面达到 WCAG AA 4.5:1；
- `tests/f6-performance.test.jsx`：长列表 DOM 上限与预览资源生命周期预算；
- `tests/f6-accessibility.test.jsx`、`tests/browser/f6-accessibility-responsive.spec.js`：键盘、焦点恢复、语义、reduced motion 与 1280/800/640/600/320px 无横向溢出。

性能数值和复现方法见 [F6-PERFORMANCE-BUDGET.md](F6-PERFORMANCE-BUDGET.md)。当前产品保持 Light-only；暗色主题不属于 F1–F6 发布门禁。

F6 收口门禁结果：Vitest 151/151；Playwright 80/80，其中非视觉浏览器 65/65、视觉 15/15；F6 专项 12/12。随后补入挂载文件直接预览和会话式消息布局：Vitest 152/152，F2/F3/响应式专项 9/9，视觉 16/16，生产构建与 `git diff --check` 通过。视觉基线现同时覆盖频道挂载文件主页面及其预览 Context。

## 2. 本地真实 Atoll Smoke

本次直接使用相邻 `../atoll` 当前工作树，不以 Mock 替代真实服务：

```bash
cd ../atoll
make build
bin/atoll up --dir "$(mktemp -d /tmp/atoll-web-smoke.XXXXXX)" --addr 127.0.0.1:8842
```

已取得的真实证据：

1. 全新临时 space 的启动日志明确存在 `c0` 与 `c0.lobby`；
2. 浏览器使用 root identity 登录后，URL 为 `#/channels/c0/dynamic`，左栏 `c0` 可见并处于选中状态，主标题也是 `c0`；
3. 连接状态达到 `OPEN`，Composer 文本框处于 enabled；
4. 文件主视图列出 `local-device`，频道默认挂载路径为 `daemon://local-device/c0/`；该证据只证明目录装配可达，不冒充真实文件写盘、ticket 一次性或跨进程兑换已验证；
5. 本次最终 smoke 未先 `@` 选择成员，因而没有提交消息，也没有证明真实入账、进展或终态响应。

## 3. 真实边界与未证明事实

本地 smoke 只证明上述 root/c0、连接、Composer 可用性和频道挂载目录的前端最小装配。以下事实不能由 Mock 或上述单节点 smoke 推断，发布到相应环境前仍须专项验证：

- 多进程或多节点并发裁决、幂等冲突和 CAS 时序；
- server/daemon 重启后的数据库、Actor、timer 和游标持久化；
- timer 跨端完整列表与权限变化语义（当前前端只声明“本设备记录”）；
- 文件 ticket 的过期、一次性、跨进程兑换及真实磁盘落盘；
- 设备 key 的日志隔离、安全 binding 投影和 attach/detach 收敛；
- 生产 TLS、反向代理、WebSocket Origin/Host 和 Cookie 属性；
- 大历史在真实 SQLite、真实网络抖动和持续 feed 下的端到端时延。
- 真实消息选择收件人后的 submit、账本入账、provisional/activity 和 terminal 闭环。
- 独立 healthz、bearer OBS 响应形状、WS attach receipt/contract version 等未在本次最终浏览器 smoke 中重新取证的接口事实。

`real-backend-shape` Mock、fixture、单元测试或浏览器 Mock E2E 均不得被描述成上述运行时事实已通过。
