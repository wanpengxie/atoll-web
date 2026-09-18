# W6 离线输入与本地持久化失败恢复

## 已实现边界

Composer 不再把“网络断开”和“没有写权限”合成一个 `disabled`：

| 能力 | 判据 | 断线后的行为 |
| --- | --- | --- |
| `canEditDraft` | 已登录 principal、频道存在、已有已知 member 关系 | 可继续编辑并保存草稿 |
| `canDurablyAccept` | 同上 | 文本可原子进入 IndexedDB outbox；UI 只称“已保存到本机” |
| `canTransmit` | 上述条件 + `wireState === open` + `member_active` | 才允许网络传输、上传、频道文件选择、消息编辑和模型设置 |

observer、discoverable、access denied、loading、未知 principal 都没有 durable accept 能力。`useSubmissions.send` 不依赖 UI 信任：它在恢复之前和真正写 IndexedDB 之前各检查一次当前 `relationship === member`，因此等待恢复期间发生撤权也不会越权排队。跨频道 batch 对每个目标频道执行相同检查。

## 草稿、outbox 与失败恢复

- Composer 先持久化当前 draft revision，再用同一 revision 调 `acceptDraft`。该事务一次性写入稳定 submission ID 并只消费匹配版本的草稿；事务等待期间的新输入不会被清掉。
- 断线 member 提交后进入 `queued`，提示“已保存到本机，连接可用后自动发送”，不显示成服务端已提交。
- Dexie `open()` 失败不再永久缓存 rejected promise。失败 generation 只清理自己的 DB/open 状态；后续显式编辑或发送会重试。
- principal hydration 同一时刻只共享一个 in-flight promise。失败后保留内存中的脏草稿并清除该 attempt；只有下一次用户编辑/发送触发重试，没有后台紧循环。
- 恢复出的 immutable frame 保留原 message ID；既有 lease/CAS 发送流程不重建请求、不删除数据库。

## 附件合同

离线 outbox 只接受有稳定、非 `blob:` `resource_id` 的附件。已上传资源若带 UI 的 `blob:` preview 或 Blob 对象，会在持久化副本和随后传输的同一 frame 中剔除 renderer 临时值，稳定资源元数据保留。没有稳定资源身份的本地文件在事务前失败，草稿不会被消费；上传、粘贴文件、拖入文件和频道文件选择在断线时保持禁用。

## 修改文件

- `src/app/AppShell.jsx`：计算并传递三项 capability，保留终端/重启等 live-only 控件原判据。
- `src/ui/Composer.jsx`：正文编辑与 durable send 使用本地能力；live-only 附件与配置使用 transport 能力。
- `src/app/hooks/useSubmissions.js`：权限双检、可重试 hydration、脏草稿合并和 stable-ID durable accept。
- `src/model/outbox-store.js`：可重试 Dexie open generation、附件持久化净化。
- `tests/offline-recovery.test.jsx`、`tests/offline-app-shell.test.jsx`、`tests/submission-outbox.test.jsx`：恢复、权限、附件和旧 unknown-access 反例。
- `tests/browser/offline-composer-recovery.spec.js`：真实 Chromium 断线编辑、刷新恢复、durable queued、原 ID 重连入账。

## 验证

定向单元/组件测试：

```text
npx vitest run tests/offline-recovery.test.jsx tests/offline-app-shell.test.jsx tests/submission-outbox.test.jsx tests/dynamic-f3.test.jsx tests/f6-composer-isolation.test.jsx tests/app-shell-terminal-split.test.jsx
6 files passed; 67 tests passed
```

独占端口浏览器测试：

```text
ATOLL_TEST_WEB_PORT=15361 ATOLL_TEST_MOCK_PORT=19061 \
  npx playwright test tests/browser/offline-composer-recovery.spec.js \
  --output docs/evidence/offline-recovery/playwright/run4
1 passed
```

`npm run build` 通过；Vite 仅报告既有的 chunk size warning。

最终成功截图和真实 queued frame 分别在 `docs/evidence/offline-recovery/playwright/run4/offline-composer-recovery--343cd-able-frame-before-reconnect/offline-durable-queued.png` 与同目录的 `offline-outbox.json`。该 JSON 记录同一个 UUID 同时作为 `messageId` 和 `frame.id`、`state: queued`、`channel_id: c0`、`audience: [steward]`。首次两轮失败证据也保留：它们确认 Playwright `context.setOffline` 本身不会关闭已建立 WebSocket，以及 reload 的旧/新 socket 会短暂重叠；最终测试用有界 mock socket drop 后保持浏览器离线，未改产品行为。

## 反例结论

- 已知 member + 断网：编辑可用、文本可 durable queue、恢复连接后自动传输。
- observer / revoked / discoverable / loading / 无 principal：编辑器只读，send seam 禁用，hook 也拒绝 durable insert。
- 无稳定 `resource_id` 的本地附件：不可离线入队，不会冒充持久化成功。
- IndexedDB 一次 open 失败：本次操作报错且草稿留在内存；下一次显式操作可恢复，不需要刷新或删除数据库。
