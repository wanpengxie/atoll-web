# A–D blocked-evidence recovery, round 20 (2026-09-20)

This packet covers the next 20 previously-uncovered blocked rows: AD-027,
AD-037, AD-156–AD-161, AD-163, AD-165–AD-173, AD-178, and AD-182.  It keeps
the baseline user capability and invariant at the current public owner.  Six
cases now have green public evidence; the other fourteen remain explicit
blocked evidence.  Expected-fail assertions are not counted as recovery.

## Focused result

```text
npx vitest run tests/blocked-round20-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       6 passed | 14 expected fail (20)
```

The focused file is [tests/blocked-round20-public-owner.test.jsx](../tests/blocked-round20-public-owner.test.jsx).
No product, vendor, package, lockfile, private export, deletion, or skip was
introduced.

## Per-case evidence

| ID | User capability | Invariant | Current public owner and setup/action | Result / disposition |
|---|---|---|---|---|
| AD-027 | processing 中编辑时，用户仍保持原 Reading 位置并获得 Composer 编辑态。 | Waiting/编辑不能替换 committed Reading owner。 | `useWaitingEditingController` starts the public edit session and `WaitingLayer` renders the current boundary at `blocked-round20-public-owner.test.jsx:106`. | **BLOCKED**: expected fail; current public Waiting owner exposes the Composer session but no committed following-tail/Reading identity at this boundary. |
| AD-037 | reconnect 后保存编辑必须使用原 hold owner 与最新 committed target。 | 候选 render、断线 callback 不能取得 hold/release owner。 | `useWaitingEditingController` drives hold, reconnect, latest target and callback handoff at `blocked-round20-public-owner.test.jsx:146`. | **BLOCKED**: expected fail; the current public hook cannot prove the baseline Reading-owner handoff without the retired Timeline composition. |
| AD-156 | inactive rail 在缓存通知上下文及 parent 完整前保持 unknown。 | notification 只能由当前 Replica/cache authority 证明。 | `ChannelFeedRuntime` attaches c0/c1, reads `unreadFor`, then folds public cached request/final rows at `blocked-round20-public-owner.test.jsx:219`. | **BLOCKED**: expected fail; current public runtime returns a known empty count before a public cached-context completion can be supplied. Fixture/owner gap remains unresolved. |
| AD-157 | boot replacement 后旧缓存 completion 不得重新显示通知。 | boot/Replica epoch 是 cache hydration admission fence。 | `ChannelFeedRuntime` replaces boot and then receives a late public cache row at `blocked-round20-public-owner.test.jsx:245`. | **BLOCKED**: expected fail; late cache ingress is still accepted at `enqueue`, so the stale row appears. Product regression packet; no product edit made. |
| AD-158 | attach revoke channel 后，在途 notification hydration 不得落账。 | grant 集合是跨频道 cache admission 边界。 | Runtime revokes c1 and then receives its late cache row at `blocked-round20-public-owner.test.jsx:264`. | **BLOCKED**: expected fail; late revoked-channel cache ingress is accepted. Product regression packet; no cross-owner fix applied. |
| AD-159 | physical reading 前进但 parent 缺失时，通知上下文保持 unknown。 | physical read cursor 与 notification context completeness 独立。 | Runtime marks c1 physical read through public authority then reads `unreadFor` at `blocked-round20-public-owner.test.jsx:283`. | **BLOCKED**: expected fail; current public `unreadFor` has no incomplete-context/unknown result. Fixture/owner gap. |
| AD-160 | inactive granted channel 的 Meta 未收敛时显示 unknown。 | 空 Replica 不能推导 Meta readiness 或已知未读数。 | Runtime attaches inactive c1 and inspects public `historyFor`/`unreadFor` at `blocked-round20-public-owner.test.jsx:302`. | **BLOCKED**: expected fail; no public non-settling-Meta fixture or unknown unread result exists. Fixture/owner gap. |
| AD-161 | reconnect history materializes a related tail fact into the mounted viewport arrival journal。 | history/live ingress 共用一个 Replica arrival owner。 | Runtime invokes public `loadHistory`, `enqueue`, `pageEnd`, and `arrivalReceipts.timeline()` at `blocked-round20-public-owner.test.jsx:320`. | **BLOCKED**: expected fail; current public boundary does not produce the one-to-one mounted-viewport reconnect journal proof. Fixture/owner gap. |
| AD-163 | 首次 self discovery 前按 exact local submission id 归类，不隐藏另一设备。 | submission correlation 以 message identity 为边界；同 principal 设备消息仍留在账本。 | Runtime adopts the first sender through the public roster callback, commits two device rows, and checks Replica arrivals at `blocked-round20-public-owner.test.jsx:349`. | **PASS**: both rows remain in Replica and the same-principal other-device row produces no personal arrival. |
| AD-165 | attach 不重复探测；明确进入频道时只发起一次 freshness probe。 | history demand 由显式 channel-entry interest 授权。 | Runtime checks no attach probe, then calls public `requestBackgroundInterest({ intent: 'channel-entry' })` at `blocked-round20-public-owner.test.jsx:372`. | **BLOCKED**: expected fail; current interest port accepts only `searchContext`, with no channel-entry owner. Product/owner gap. |
| AD-166 | empty channel 在 reconnect/foreground return 各生成一次 fresh probe。 | 每个 obligation 只有一个可取消 probe owner。 | Runtime requests public channel-entry/reconnect/foreground interests at `blocked-round20-public-owner.test.jsx:392`. | **BLOCKED**: expected fail; current public port cannot represent any of these obligations. Product/owner gap. |
| AD-167 | revoked active channel 不探测；后续 grant 才恢复 pending interest。 | grant epoch fences probe admission. | Runtime removes c0 grant, calls public `refreshChannel`, then grants a successor generation at `blocked-round20-public-owner.test.jsx:412`. | **BLOCKED**: expected fail; `refreshChannel` still probes after grant removal. Product regression packet. |
| AD-168 | current `channel_meta forbidden` 权威撤销，later grant 可恢复。 | 旧 generation error 不能污染 successor authority。 | Runtime uses public `refreshChannel` with forbidden then a new generation at `blocked-round20-public-owner.test.jsx:434`. | **PASS**: current forbidden detaches the channel and successor grant refresh succeeds. |
| AD-169 | transient `channel_meta` failure 保持 admitted 且可 retry。 | 只有明确 forbidden 才能撤销 access。 | Runtime uses public `refreshChannel` with timeout then a successful retry at `blocked-round20-public-owner.test.jsx:458`. | **PASS**: attached/messageCurrent remains true and retry succeeds. |
| AD-170 | scheduler 在 forbidden probe 中 reset 后，旧 cached access 不可见。 | access revoke 必须同步撤下当前 projection。 | Runtime seeds a public c0 row, projects forbidden, and inspects the Replica at `blocked-round20-public-owner.test.jsx:478`. | **BLOCKED**: expected fail; status is revoked but materialized cached row remains visible. Product regression packet. |
| AD-171 | owner/boot persistence 未 ready 时 live 先可见，旧持久化不能覆盖 successor world。 | live Replica commit 与 cache persistence 分离并受 owner epoch fence。 | Runtime commits a live row before `prepareLocalReplica` settles and changes boot at `blocked-round20-public-owner.test.jsx:495`. | **PASS**: live row is immediately visible and absent from successor boot. |
| AD-172 | attach grant 中省略的 channel 不得被 late cache Meta 安装。 | grant 集合限制 Meta/row admission。 | A seeded c1 cache is followed by a successor attach granting only c0 at `blocked-round20-public-owner.test.jsx:519`. | **PASS**: c1 Meta/row is not installed. |
| AD-173 | revoked channel/successor generation 不保留 rejected pre-Meta receipt。 | receipt ref、attach epoch、generation 必须共同 fencing。 | Runtime resolves a public history receipt after grant removal, then attaches successor generation at `blocked-round20-public-owner.test.jsx:550`. | **PASS**: late receipt does not install c1 rows in either generation. |
| AD-178 | Meta ready 后先建立 live queue，不等待 selected cache body。 | Meta/readiness 与 body hydration 是可并行的独立事实。 | A public cache row is seeded, then successor `prepareLocalReplica` is observed at `blocked-round20-public-owner.test.jsx:576`. | **BLOCKED**: expected fail; current public prepare resolves with the selected body already materialized, so no equivalent Meta/body separation is exposed. |
| AD-182 | terminal-first suffix 经 mobile trim 和 older page 后仍 closed，不进入 Waiting。 | trim 丢 body 但必须保留 compact terminal closure。 | Runtime uses public history ingress, 510 live rows, and an older request page at `blocked-round20-public-owner.test.jsx:596`. | **BLOCKED**: expected fail; no current public trim/compact-closure handoff keeps the terminal-first turn closed. Product/owner gap. |

## Ledger / boundary handoff

The A–D ledger moves from **288 PASS / 0 REGRESSION / 77 BLOCKED** to
**294 PASS / 0 REGRESSION / 71 BLOCKED**.  Promoted rows are AD-163, AD-168,
AD-169, AD-171, AD-172, and AD-173.  Fourteen expected-fail assertions remain
explicit unresolved evidence and are not counted as completion or obsolete
cases.

The blocked rows split into reproducible product gaps (AD-157, AD-158,
AD-165–AD-167, AD-170, AD-182) and missing public fixture/owner proof
(AD-027, AD-037, AD-156, AD-159–AD-161, AD-178).  No cross-owner
product edit was made; each product gap is handed back with its first public
boundary and minimal reproduction above.
