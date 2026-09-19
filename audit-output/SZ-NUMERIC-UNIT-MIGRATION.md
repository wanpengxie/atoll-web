# S–Z / numeric-prefix unit migration ledger (fae8b70)

Scope: top-level tests whose basename begins with a digit or S–Z; it.each rows count separately. Browser specs are excluded. Every baseline case retains its exact title and points to a suite contract for capability/invariant and public owner. No deletion, skip, private export, compatibility layer, or source edit was used.

## Scope and result

- Baseline: 331 executable cases in 39 suites.
- Focused pre-fix candidates: 30 files / 143 cases → 135 passed, 8 failed, plus one Outbox teardown DatabaseClosedError. Post-fix direct owner checks: 12/12 StructuredResult/message-presentation tests and 13/13 processing-control tests passed.
- Disposition: 117 GREEN, 3 RED, 1 PARTIAL, 187 OPEN, 20 GAP, 3 BLOCKED. Action rows: 214 (OPEN + GAP + PARTIAL + RED + BLOCKED pending ruling).
- Remaining product regressions without source changes: daemon secret projection and the separately listed WorkspaceLayout pointer-focus packet. R-SZ-002A/B/C and R-SZ-005 are resolved in the public renderer and Outbox races remain handoff-only to `composer_owner`, with no duplicate packet here.

## Suite contracts

| ID | Baseline suite | Cases | Capability / invariant | Current public owner | Disposition |
|---|---|---:|---|---|---|
| S01 | tests/send-scroll-transaction.test.js | 10 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for send-scroll-transaction; successor still required | 0 GREEN / 0 RED / 10 OPEN / 0 GAP / 0 BLOCKED |
| S02 | tests/server-boot.test.js | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | ChannelFeedRuntime.setHistoryGrants + world Replica | 2 GREEN / 0 RED / 0 OPEN / 0 GAP / 1 BLOCKED |
| S03 | tests/space-administration.test.js | 8 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | useWireConnection accessRef.directory + governance ports | 0 GREEN / 1 RED / 0 OPEN / 7 GAP / 0 BLOCKED |
| S04 | tests/structured-result-ui.test.jsx | 2 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | TimelineRowRenderer StructuredResult | 2 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S05 | tests/structured-result.test.js | 4 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | TimelineRowRenderer useTimelineRowRenderer | 4 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S06 | tests/submission-outbox.test.jsx | 16 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | useComposerSubmissionRuntime + outbox-store | 9 GREEN / 2 RED / 3 OPEN / 1 GAP / 0 BLOCKED |
| S07 | tests/submissions.test.js | 4 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | useComposerSubmissionRuntime pending/reconcileFeed | 4 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S08 | tests/surface-shell-visual-viewport.test.jsx | 1 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for surface-shell-visual-viewport; successor still required | 1 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S09 | tests/sync-data-fuzz.test.js | 10 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | channel-replica + sync-session | 10 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S10 | tests/system-events.test.js | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for system-events; successor still required | 0 GREEN / 0 RED / 3 OPEN / 0 GAP / 0 BLOCKED |
| S11 | tests/task-controls.test.js | 9 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | WaitingLayer public component | 9 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S12 | tests/tasks-f4.test.jsx | 4 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | TasksFeature public port | 4 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S13 | tests/terminal-view.test.jsx | 14 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | TerminalFeature + terminal-session | 1 GREEN / 0 RED / 13 OPEN / 0 GAP / 0 BLOCKED |
| S14 | tests/test-integrity-contract.test.js | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | runner/test setup contract | 6 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S15 | tests/timeline-agent-activity.test.jsx | 2 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-agent-activity; successor still required | 1 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |
| S16 | tests/timeline-channel-switch.test.jsx | 12 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-channel-switch; successor still required | 0 GREEN / 0 RED / 12 OPEN / 0 GAP / 0 BLOCKED |
| S17 | tests/timeline-filter-presentation.test.jsx | 20 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-filter-presentation; successor still required | 2 GREEN / 0 RED / 18 OPEN / 0 GAP / 0 BLOCKED |
| S18 | tests/timeline-presentation-identity.test.js | 20 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | conversation-presentation evaluate/commitCandidate | 14 GREEN / 0 RED / 6 OPEN / 0 GAP / 0 BLOCKED |
| S19 | tests/timeline-reading-integration.test.jsx | 71 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | useReadingSession + projection + VendorListExecutor | 0 GREEN / 0 RED / 71 OPEN / 0 GAP / 0 BLOCKED |
| S20 | tests/timeline-render-authority.test.jsx | 1 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-render-authority; successor still required | 0 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |
| S21 | tests/timeline-row-measurement-revision.test.jsx | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-row-measurement-revision; successor still required | 1 GREEN / 0 RED / 2 OPEN / 0 GAP / 0 BLOCKED |
| S22 | tests/timeline-scope-incremental.test.js | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-scope-incremental; successor still required | 0 GREEN / 0 RED / 3 OPEN / 0 GAP / 0 BLOCKED |
| S23 | tests/timeline-scope.test.js | 16 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timeline-scope; successor still required | 0 GREEN / 0 RED / 16 OPEN / 0 GAP / 0 BLOCKED |
| S24 | tests/timers.test.js | 2 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for timers; successor still required | 1 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |
| S25 | tests/turn-presentation.test.js | 1 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for turn-presentation; successor still required | 0 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |
| S26 | tests/ui-activity-overlay.test.jsx | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | no current ui.* receipt consumer | 0 GREEN / 0 RED / 0 OPEN / 6 GAP / 0 BLOCKED |
| S27 | tests/ui-primitives.test.jsx | 7 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for ui-primitives; successor still required | 6 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |
| S28 | tests/ui-words-hook.test.jsx | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | no current ui.* command port | 0 GREEN / 0 RED / 0 OPEN / 6 GAP / 0 BLOCKED |
| S29 | tests/version-incompatible.test.jsx | 1 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | WorkspaceApp incompatible port + UI | 1 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S30 | tests/view-session.test.js | 8 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | view-session public store | 6 GREEN / 0 RED / 0 OPEN / 0 GAP / 2 BLOCKED |
| S31 | tests/visual-interaction-contract.test.jsx | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | VendorListExecutor + reading-dom-command-executor + SurfaceShell | 6 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S32 | tests/waiting-closure-entry.test.jsx | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for waiting-closure-entry; successor still required | 0 GREEN / 0 RED / 6 OPEN / 0 GAP / 0 BLOCKED |
| S33 | tests/waiting-layout.test.jsx | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | ConversationSurface + WaitingLayer + Composer layout | 3 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S34 | tests/waiting-presentation.test.js | 6 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for waiting-presentation; successor still required | 0 GREEN / 0 RED / 6 OPEN / 0 GAP / 0 BLOCKED |
| S35 | tests/waiting-terminal-finality.test.js | 11 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | current public owner boundary for waiting-terminal-finality; successor still required | 0 GREEN / 0 RED / 11 OPEN / 0 GAP / 0 BLOCKED |
| S36 | tests/wire.test.js | 18 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | createWire public client | 18 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S37 | tests/work-items.test.js | 4 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | feature-tasks + task feature port | 4 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S38 | tests/workspace-bootstrap-cache.test.js | 1 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | workspace-bootstrap-cache public store | 1 GREEN / 0 RED / 0 OPEN / 0 GAP / 0 BLOCKED |
| S39 | tests/workspace-route.test.js | 3 | preserve every baseline user-visible capability/invariant named by its exact titles; implementation details are not an owner | useChannelNavigation route owner | 2 GREEN / 0 RED / 1 OPEN / 0 GAP / 0 BLOCKED |

## Complete case ledger

GREEN=current public-owner proof; RED=product regression; PARTIAL=related path only; OPEN=successor not built; GAP=no current owner; BLOCKED=retired implementation/storage oracle retained pending explicit product/data ruling (not closed or deleted).

| Case | Exact baseline file/title | Contract | Result / evidence |
|---|---|---|---|
| SZ-001 | tests/send-scroll-transaction.test.js — joins ${order.join(' before ')} into send-ready authority | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-002 | tests/send-scroll-transaction.test.js — accepts a committed queued destination as the send intent write | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-003 | tests/send-scroll-transaction.test.js — joins every target destination in a mixed batch before the send write | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-004 | tests/send-scroll-transaction.test.js — does not suppress later same-id stream for a timeline destination | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-005 | tests/send-scroll-transaction.test.js — ignores a stale destination acknowledgement after a newer ready revision | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-006 | tests/send-scroll-transaction.test.js — joins an earlier target-row measurement with later metadata-only timeline readiness | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-007 | tests/send-scroll-transaction.test.js — does not mistake an unrelated post-baseline layout measurement for target geometry | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-008 | tests/send-scroll-transaction.test.js — uses the latest same-revision public target measurement when measured height decreases | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-009 | tests/send-scroll-transaction.test.js — allows a committed waiting destination while the list stays at the baseline revision | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-010 | tests/send-scroll-transaction.test.js — invalidates before write on user takeover or activation replacement | S01 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-011 | tests/server-boot.test.js — records the first boot without invalidating state created by this login | S02 | **BLOCKED** — retired storage/implementation shape retained pending explicit product/data ruling; current fact documented |
| SZ-012 | tests/server-boot.test.js — invalidates Atoll local state when an established boot changes | S02 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-013 | tests/server-boot.test.js — reports an epoch change even when there were no projection keys to remove | S02 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-014 | tests/space-administration.test.js — builds actor template commands and protects system declarations | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-015 | tests/space-administration.test.js — refuses a declaration name that could not be an actor id segment | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-016 | tests/space-administration.test.js — targets overlay/profile at the source channel system actor | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-017 | tests/space-administration.test.js — materializes local-device in every channel template body | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-018 | tests/space-administration.test.js — projects daemon observations without secret fields | S03 | **RED** — current public-owner repro fails baseline assertion; hand to owner, no source change here |
| SZ-019 | tests/space-administration.test.js — projects the channel-scoped device authority separately from space inventory | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-020 | tests/space-administration.test.js — parses object JSON and reads authoritative terminal phase | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-021 | tests/space-administration.test.js — builds device actions with closed real fields | S03 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-022 | tests/structured-result-ui.test.jsx — 纯 JSON 文本结果默认收起，用户点击后才展开 | S04 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-023 | tests/structured-result-ui.test.jsx — 结构化协议结果默认收起并限制在独立滚动区 | S04 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-024 | tests/structured-result.test.js — 以 cancelled 事实优先解释取消终态 | S05 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-025 | tests/structured-result.test.js — never renders successful non-text results as an empty answer | S05 | **GREEN** — R-SZ-002A (`system.channel.list`) and R-SZ-002B (`actor.describe`) now retain protocol-specific titles through the public renderer; direct owner suite passed |
| SZ-026 | tests/structured-result.test.js — keeps failure facts and redacts sensitive fields recursively | S05 | **GREEN** — R-SZ-002C maps `type_unsupported` to the user-facing label and recursively redacts nested/array fields; direct owner suite passed |
| SZ-027 | tests/structured-result.test.js — redacts registrar value secrets before rendering | S05 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-028 | tests/submission-outbox.test.jsx — does not publish transport authority from a suspended candidate render | S06 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-029 | tests/submission-outbox.test.jsx — reads transport authority at execution time through a stable Composer callback | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-030 | tests/submission-outbox.test.jsx — accepts locally while disconnected and automatically transmits after reconnect | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-031 | tests/submission-outbox.test.jsx — does not durably queue unknown access, then accepts after membership is confirmed | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-032 | tests/submission-outbox.test.jsx — keeps a retryable unavailable refusal queued and reuses its stable id once service recovers | S06 | **PARTIAL** — related path is exercised but this branch remains unproven |
| SZ-033 | tests/submission-outbox.test.jsx —  | S06 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-034 | tests/submission-outbox.test.jsx —  | S06 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-035 | tests/submission-outbox.test.jsx — does not downgrade an in-flight submission when access changes before its accepted receipt | S06 | **RED / HANDOFF ONLY** — current public-owner repro fails baseline assertion; hand only to `composer_owner`, no duplicate product packet or source change here |
| SZ-036 | tests/submission-outbox.test.jsx — does not durably accept a new submission for a retired channel even if its old relationship was member | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-037 | tests/submission-outbox.test.jsx — does not hot-loop the same durable id while an open wire keeps returning uncertain | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-038 | tests/submission-outbox.test.jsx — keeps a definitive rejection visible without self-retrying it | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-039 | tests/submission-outbox.test.jsx — treats feed-before-receipt as landed without retransmitting or emitting another send phase | S06 | **RED / HANDOFF ONLY** — current public-owner repro fails baseline assertion; hand only to `composer_owner`, no duplicate product packet or source change here |
| SZ-040 | tests/submission-outbox.test.jsx — treats receipt-before-feed as one attempt and leaves rejection/retry decisions to the user | S06 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-041 | tests/submission-outbox.test.jsx — does not resurrect a ledger-confirmed id when feed races principal hydration | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-042 | tests/submission-outbox.test.jsx — does not resurrect a ledger-confirmed legacy id when feed races its migration | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-043 | tests/submission-outbox.test.jsx — atomically accepts immutable frames without consuming a newer draft | S06 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-044 | tests/submissions.test.js — keeps a stable client message id and removes it only when feed lands | S07 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-045 | tests/submissions.test.js — restores in-flight transmitting as uncertain and distinguishes definitive rejection | S07 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-046 | tests/submissions.test.js — persists a never-transmitted offline submission as queued | S07 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-047 | tests/submissions.test.js — restores explicit recovery states, clears foreign leases, and never regresses accepted work | S07 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-048 | tests/surface-shell-visual-viewport.test.jsx — publishes one synchronous visual viewport frame without remounting focused content | S08 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-049 | tests/sync-data-fuzz.test.js — fuzzes arbitrary live/history arrival order without duplicating Replica facts | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-050 | tests/sync-data-fuzz.test.js — fuzzes persistence epochs so no write crosses the selected world fence | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-051 | tests/sync-data-fuzz.test.js — fuzzes cache-world classification conservatively | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-052 | tests/sync-data-fuzz.test.js — does not fulfill interest when only the head probe succeeded | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-053 | tests/sync-data-fuzz.test.js — fulfills an authoritative empty head without waiting for a push | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-054 | tests/sync-data-fuzz.test.js — re-probes a pending obligation when an old connection resolves after reconnect | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-055 | tests/sync-data-fuzz.test.js — disconnect aborts a non-settling probe so reconnect can own the obligation | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-056 | tests/sync-data-fuzz.test.js — does not let an old connection late catchup fulfill the replacement connection | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-057 | tests/sync-data-fuzz.test.js — fences revoked admission, ignores its late probe, and resumes the pending interest after grant | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-058 | tests/sync-data-fuzz.test.js — blocks a current definitive denial without retry and fences an older denial from a restored grant | S09 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-059 | tests/system-events.test.js — decodes the closed backend contract by event type | S10 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-060 | tests/system-events.test.js — never guesses semantics from arbitrary JSON field names | S10 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-061 | tests/system-events.test.js — maps canonical facts to product language and hides standard actors | S10 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-062 | tests/task-controls.test.js — requires a writable channel and an advertised control | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-063 | tests/task-controls.test.js — lets any writing member act on work it did not send | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-064 | tests/task-controls.test.js — cancels your own request, and asks the holder to drop anyone else's | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-065 | tests/task-controls.test.js — offers no drop for others when the holder does not advertise it | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-066 | tests/task-controls.test.js — draws nothing when the account advertises no controls | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-067 | tests/task-controls.test.js — routes unknown advertised words to the generic path with label fallback | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-068 | tests/task-controls.test.js — keeps caller cancel but disables receiver-directed controls until exact roster authority is current | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-069 | tests/task-controls.test.js — requires principal, channel, generation, completeness and exact actor IDs for current authority | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-070 | tests/task-controls.test.js — 并入中的排队请求：按钮清空，steering 事实为真 | S11 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-071 | tests/tasks-f4.test.jsx — 没有 provider 时解释真实空态且不显示新建任务 | S12 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-072 | tests/tasks-f4.test.jsx — 按语义分组并打开工作项 | S12 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-073 | tests/tasks-f4.test.jsx — 任务 Modal 保留来源并只提交所选真实 provider | S12 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-074 | tests/tasks-f4.test.jsx — 自动动作详情明确本设备范围并提供取消 | S12 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-075 | tests/terminal-view.test.jsx — 挂载不抛错，并在共享连接上按频道开一条流 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-076 | tests/terminal-view.test.jsx — 多块终端共用一条 WebSocket | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-077 | tests/terminal-view.test.jsx — 旧连接关闭握手完成前不创建下一条连接 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-078 | tests/terminal-view.test.jsx — 连接 ready 前的输入不会静默丢失 | S13 | **GREEN** — successor `tests/terminal-feature.test.jsx` proves TerminalFeature buffers pre-handle input and the shared PTY sends it exactly once after `ready` |
| SZ-079 | tests/terminal-view.test.jsx — 隐藏时恒不断开连接——切页签不是断线 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-080 | tests/terminal-view.test.jsx — canWrite 变化恒不重建连接——权限抖动不该丢掉正在跑的 shell | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-081 | tests/terminal-view.test.jsx — 卸载走 detach 恒不走 close——切走频道恒不杀 shell | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-082 | tests/terminal-view.test.jsx — 拿到 ready 后把 session 记下来，重新挂载时带上它 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-083 | tests/terminal-view.test.jsx — 提供配色切换 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-084 | tests/terminal-view.test.jsx — 死掉的 session 被拒 → 丢掉它重开，恒不无限重试同一个死 id | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-085 | tests/terminal-view.test.jsx — 全新会话也连不上时恒不空转，给出可重试的终止态 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-086 | tests/terminal-view.test.jsx — shell 退出时只结束这一条流，恒不关整条连接 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-087 | tests/terminal-view.test.jsx — 卸载后到达的 WebGL 续体恒不再往死掉的终端上装载 | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-088 | tests/terminal-view.test.jsx — 活着的终端照常装上 WebGL | S13 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-089 | tests/test-integrity-contract.test.js — shared setup does not mock a virtualizer or synthesize timeline geometry | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-090 | tests/test-integrity-contract.test.js — the unused Legend list dependency stays removed | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-091 | tests/test-integrity-contract.test.js — semantic list helper renders every supplied row | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-092 | tests/test-integrity-contract.test.js — tests do not mock or inspect the removed MessageList module | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-093 | tests/test-integrity-contract.test.js — a spec may only claim a ResizeObserver loop is absent from a channel that sees it | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-094 | tests/test-integrity-contract.test.js — the unit runner excludes durable evidence sources | S14 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-095 | tests/timeline-agent-activity.test.jsx — acknowledges settled activity through the existing member filter interaction | S15 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-096 | tests/timeline-agent-activity.test.jsx — balances consumers without treating A→B→A replacement as visible-arrival acknowledgement | S15 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-097 | tests/timeline-channel-switch.test.jsx — 换频道就换一棵消息树，恒不复用同一个 DOM 容器 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-098 | tests/timeline-channel-switch.test.jsx — 反复切频道后，消息区恒只有一棵 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-099 | tests/timeline-channel-switch.test.jsx — 消息区这一层恒不出现重复 key 警告 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-100 | tests/timeline-channel-switch.test.jsx — 后台蓄水池增长不推动可见列表，且不存在手动加载按钮 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-101 | tests/timeline-channel-switch.test.jsx — 测试端口把调度事实放在 status，动作保留为顶层 port | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-102 | tests/timeline-channel-switch.test.jsx — 短首屏已经触顶时自动释放一批 reservoir | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-103 | tests/timeline-channel-switch.test.jsx — 短视口只在 attach 明确公布 hasOlder 后建立欠供给 demand | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-104 | tests/timeline-channel-switch.test.jsx — attach 前的非权威 false 不会封死 attach 后的同一欠供给视口 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-105 | tests/timeline-channel-switch.test.jsx — 失败后的scheduler状态推进会重新兑现同一欠供给义务 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-106 | tests/timeline-channel-switch.test.jsx — scheduler 兑现 demand 且真正 prepend 可见项后不重复消费 reservoir | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-107 | tests/timeline-channel-switch.test.jsx — 隐藏行导致 rerender 时仍由同一个顶部 operation 持有 continuation | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-108 | tests/timeline-channel-switch.test.jsx — 频道 DOM 重挂后从 View Session 恢复阅读范围 | S16 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-109 | tests/timeline-filter-presentation.test.jsx — same-phase Admission authority advance forces a fresh projection after stale receipt rejection | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-110 | tests/timeline-filter-presentation.test.jsx — 混合 Codex/Claude 已加载回合按精确成员 ID 立即保留完整问答 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-111 | tests/timeline-filter-presentation.test.jsx — 零行成员投影用当前 viewSpec 请求可见语义供给而不等待虚拟列表 underfill | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-112 | tests/timeline-filter-presentation.test.jsx — 无 self 身份的全部视图仍会静默补齐被协议事实遮住的语义供给 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-113 | tests/timeline-filter-presentation.test.jsx — 断线本地首批无匹配行时继续读取更深 IndexedDB 语义供给 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-114 | tests/timeline-filter-presentation.test.jsx — 频道新鲜度失败显示其真实错误并由重试按钮续同一 sync obligation | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-115 | tests/timeline-filter-presentation.test.jsx — Meta 已知但 Replica 零行且 tail 未 current 时由 Scheduler 推进并显示获取反馈 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-116 | tests/timeline-filter-presentation.test.jsx — 缓存正文保持可读并正交显示 freshness pending、error 与同 owner 重试 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-117 | tests/timeline-filter-presentation.test.jsx — 零行筛选供给失败后由 scheduler 状态推进恢复并保留前台重试语义 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-118 | tests/timeline-filter-presentation.test.jsx — 零行且已扫描过页面时仍展示当前 source 失败并由 Retry 重开 exact block | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-119 | tests/timeline-filter-presentation.test.jsx — 已缓存正文在前台历史失败时保持可读并显示同一 Retry 入口 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-120 | tests/timeline-filter-presentation.test.jsx — 已缓存正文不被纯后台 source 错误覆盖 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-121 | tests/timeline-filter-presentation.test.jsx — opaque actor ID 与系统事实尾下，名册迟到后显示唯一 agent chip 且保留同 principal 旧回合 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-122 | tests/timeline-filter-presentation.test.jsx — 成员过滤按钮收窄呈现条目 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-123 | tests/timeline-filter-presentation.test.jsx — 旧incarnation的持久筛选始终可见可移除，不装作未过滤空态 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-124 | tests/timeline-filter-presentation.test.jsx — 只有已完成同步的已知空频道才显示空账邀请 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-125 | tests/timeline-filter-presentation.test.jsx — 重连的零头占位在前台probe完成前不是权威空频道 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-126 | tests/timeline-filter-presentation.test.jsx — 过滤后的首个物理批次显示稳定查找说明并保持同一前台供给 | S17 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-127 | tests/timeline-filter-presentation.test.jsx — 身份迟到前临时显示全部但保留 Mine 偏好，身份到达后原地恢复 Mine | S17 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-128 | tests/timeline-filter-presentation.test.jsx — 身份迟到不覆盖用户明确保存的 All 偏好 | S17 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-129 | tests/timeline-presentation-identity.test.js — uses semantic identities independent from array position | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-130 | tests/timeline-presentation-identity.test.js — classifies prepend, append, and mixed commits | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-131 | tests/timeline-presentation-identity.test.js — hands a visual slot only to a reciprocal replacement at the same committed row position | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-132 | tests/timeline-presentation-identity.test.js — keeps the replacement position relative to surviving rows across an unrelated prepend | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-133 | tests/timeline-presentation-identity.test.js — does not infer a visual slot from one-way protocol facts, reorders, or a new view epoch | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-134 | tests/timeline-presentation-identity.test.js — retains the original visual slot across committed reciprocal replacement chains | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-135 | tests/timeline-presentation-identity.test.js — does not hand a stable child root slot to a replacement folded into another visual root | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-136 | tests/timeline-presentation-identity.test.js — reports simultaneous front and back insertions as orthogonal mixed structure | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-137 | tests/timeline-presentation-identity.test.js — keeps prepend structure orthogonal from an existing-row revision | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-138 | tests/timeline-presentation-identity.test.js — detaches published rows from mutable replica entries | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-139 | tests/timeline-presentation-identity.test.js — looks up one nested progress root without revisiting every committed entry | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-140 | tests/timeline-presentation-identity.test.js — bounds structural subject lookup to one evaluate-local root scan | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-141 | tests/timeline-presentation-identity.test.js — does not reinterpret the old window head when a predecessor arrives | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-142 | tests/timeline-presentation-identity.test.js — publishes consumed source readiness without rewriting unchanged rows or geometry | S18 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-143 | tests/timeline-presentation-identity.test.js — includes content and local layout decisions in the geometry key | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-144 | tests/timeline-presentation-identity.test.js — publishes latest only from an exact authority token and keeps role out of geometry | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-145 | tests/timeline-presentation-identity.test.js — keeps the same candidate across prepend and excludes control-only tail rows | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-146 | tests/timeline-presentation-identity.test.js — publishes exact role deltas on a separate monotonic revision | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-147 | tests/timeline-presentation-identity.test.js — publishes a projection candidate exactly once after commit | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-148 | tests/timeline-presentation-identity.test.js — publishes a latest-role candidate exactly once after commit | S18 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-149 | tests/timeline-reading-integration.test.jsx — selects every newer event from a sparse, stable-key-collapsed arrival prefix | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-150 | tests/timeline-reading-integration.test.jsx — 只有生产时间线确认位于最新端后才回报已读序号 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-151 | tests/timeline-reading-integration.test.jsx — filtered tail clears its exact visible notice without advancing the physical channel cursor | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-152 | tests/timeline-reading-integration.test.jsx — retries one fenced receipt when HistoryDemand becomes current without new geometry | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-153 | tests/timeline-reading-integration.test.jsx — keeps the rejected receipt in ReadingSession until Cursors accepts it exactly once | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-154 | tests/timeline-reading-integration.test.jsx — does not carry a rejected receipt across a generation or semantic-scope replacement | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-155 | tests/timeline-reading-integration.test.jsx — unfiltered all advances physical read and acknowledges the exact current identity | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-156 | tests/timeline-reading-integration.test.jsx — does not reuse an older generation DOM observation to advance a reattached cursor | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-157 | tests/timeline-reading-integration.test.jsx — 旧activation的迟到观察不会被hook改写为当前activation | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-158 | tests/timeline-reading-integration.test.jsx — aborted render cannot publish candidate snapshot or markRead authority to the committed DOM | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-159 | tests/timeline-reading-integration.test.jsx — aborted render cannot lend candidate history status to a committed request promise | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-160 | tests/timeline-reading-integration.test.jsx — late history completion cannot cache exhaustion for a newer committed generation | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-161 | tests/timeline-reading-integration.test.jsx — 旧generation的失败operation不能封锁当前generation的anticipatory恢复 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-162 | tests/timeline-reading-integration.test.jsx — aborted render cannot redirect a committed arrival disposition to its candidate port | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-163 | tests/timeline-reading-integration.test.jsx — 隐藏期间不冒充已读，Surface隐藏会显式废弃旧尾部证据 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-164 | tests/timeline-reading-integration.test.jsx — 缺少显式Surface可见性或仍是旧DOM high-water时不读新seq | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-165 | tests/timeline-reading-integration.test.jsx — 隐藏期间arrival保留未读，回前台不复用旧DOM证据全清 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-166 | tests/timeline-reading-integration.test.jsx — joins a passive same-row arrival with the already committed visible-tail evidence | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-167 | tests/timeline-reading-integration.test.jsx — does not publish a transient unseen count before the matching visible row revision commits | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-168 | tests/timeline-reading-integration.test.jsx — hands an undisposed arrival to the successor activation before acknowledging Replica | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-169 | tests/timeline-reading-integration.test.jsx — publishes a committed arrival only after observation proves its exact row was not visible | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-170 | tests/timeline-reading-integration.test.jsx — drops a staged arrival when a later filter commit removes every row identity | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-171 | tests/timeline-reading-integration.test.jsx — retains the stable root identity when an orphan terminal row is rekeyed | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-172 | tests/timeline-reading-integration.test.jsx — acknowledges only the exact visible arrival identity while browsing | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-173 | tests/timeline-reading-integration.test.jsx — durable acceptance resolves after user-up without minting a fresh bottom intent | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-174 | tests/timeline-reading-integration.test.jsx — revokes only the exact failed composer intent and cannot revoke a newer latest intent | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-175 | tests/timeline-reading-integration.test.jsx — keeps unseen until an explicit latest intent is acknowledged by the installed visible tail | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-176 | tests/timeline-reading-integration.test.jsx — does not admit legacy key-only unseen state into the active controller | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-177 | tests/timeline-reading-integration.test.jsx — an A→B→A replacement cannot let the old durable acceptance restart its controller | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-178 | tests/timeline-reading-integration.test.jsx — 同频道语义view切换会为未安装的保存书签重新开启初始化供给 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-179 | tests/timeline-reading-integration.test.jsx — gen0 缓存请求在 gen1 source lease 已渲染后才取消时重获零行投影供给 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-180 | tests/timeline-reading-integration.test.jsx — 旧请求先结算后 source A→B→C 仍只为当前 C 重获一次供给 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-181 | tests/timeline-reading-integration.test.jsx — local-only exhausted 完成当前供给义务且只由真实 source/cache 进度重开 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-182 | tests/timeline-reading-integration.test.jsx — 保存书签的 gen0 结果在 gen1 source lease 已渲染后落定时重获同一目标 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-183 | tests/timeline-reading-integration.test.jsx — 保存书签在同source供给推进且旧attempt迟到结束时重验同一immutable目标 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-184 | tests/timeline-reading-integration.test.jsx — 保存书签 attempt 在 view 卸载时取消，失败后的 Retry 重放同一 immutable target | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-185 | tests/timeline-reading-integration.test.jsx — detached cache 错误保留已读 rows，并提供独立 typed Retry 状态 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-186 | tests/timeline-reading-integration.test.jsx — fresh following 立即显示缓存Projection，但在Replica修订消费前不授权尾随 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-187 | tests/timeline-reading-integration.test.jsx — freezes one backlog notification boundary and waits for presented follow evidence before advancing again | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-188 | tests/timeline-reading-integration.test.jsx — retries the same frozen notification event after Meta advances | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-189 | tests/timeline-reading-integration.test.jsx — keeps a rejected frozen notification while browsing and births the newer backlog only at a fresh tail | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-190 | tests/timeline-reading-integration.test.jsx — 真实上滚会把同一个anticipatory历史operation升级为可见interactive demand | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-191 | tests/timeline-reading-integration.test.jsx — 同generation的远端EOF只封住原供给证书，后到reservoir仍重开同一可见义务 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-192 | tests/timeline-reading-integration.test.jsx — 同供给active attempt期间viewport预算变化在settle后交回DOM owner重验 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-193 | tests/timeline-reading-integration.test.jsx — reservoir在旧EOF settle前发布时保留一个同义务successor且不缓存迟到EOF | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-194 | tests/timeline-reading-integration.test.jsx — 新供给不能继承旧attempt的anticipatory失败且successor仍执行 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-195 | tests/timeline-reading-integration.test.jsx — blocking admission结束后把anticipatory underfill交回DOM owner重验而不直接取数 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-196 | tests/timeline-reading-integration.test.jsx — underfill satisfied后Admission拒绝仍把同一DOM欠账交回并开启下一attempt | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-197 | tests/timeline-reading-integration.test.jsx — 零行供给settle后的live admission事务先提交首批，再续发排队的interactive demand | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-198 | tests/timeline-reading-integration.test.jsx — 旧activation或generation的live admission不能阻塞当前历史请求 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-199 | tests/timeline-reading-integration.test.jsx — 只从当前generation的权威exhaustion派生稀疏筛选顶部边界 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-200 | tests/timeline-reading-integration.test.jsx — 冷入口只在Virtuoso报告当前activation首个公开range后退出materializing | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-201 | tests/timeline-reading-integration.test.jsx — 冷入口丢失range回调后由当前可见DOM观测收敛materializing | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-202 | tests/timeline-reading-integration.test.jsx — 缺失书签继续请求恢复供给，但已有可读rows不再暴露阻塞初始化 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-203 | tests/timeline-reading-integration.test.jsx — authoritative known-zero 直接安装空呈现，不与恢复提示同帧 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-204 | tests/timeline-reading-integration.test.jsx — 只把当前activation之后的live稳定身份累计为新动态 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-205 | tests/timeline-reading-integration.test.jsx — consumes an overflowed live batch exactly and de-duplicates beyond 256 identities | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-206 | tests/timeline-reading-integration.test.jsx — does not sign intermediate history batch tails until coverage reaches the authoritative head | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-207 | tests/timeline-reading-integration.test.jsx — requires a current durable physical tail before a local echo can inherit current-entry role | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-208 | tests/timeline-reading-integration.test.jsx — reaching the installed tail acknowledges the whole installed backlog of the scope, not only visible rows | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-209 | tests/timeline-reading-integration.test.jsx — a jump-to-latest clears nothing until the tail is actually reached | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-210 | tests/timeline-reading-integration.test.jsx — a tail receipt never sweeps rows that landed above the observed installed high-water | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-211 | tests/timeline-reading-integration.test.jsx — a staged arrival above the reached tail stays pending instead of being acknowledged by that tail | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-212 | tests/timeline-reading-integration.test.jsx — browsing away from the tail still acknowledges individually seen rows and keeps the rest | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-213 | tests/timeline-reading-integration.test.jsx — a filtered tail acknowledges only identities its own projection installed and never the physical cursor | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-214 | tests/timeline-reading-integration.test.jsx — an unfiltered tail advances the physical cursor to the installed high-water even when that row is above the viewport | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-215 | tests/timeline-reading-integration.test.jsx — installedTailReadRows bounds identities by the installed high-water and drops local echo rows | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-216 | tests/timeline-reading-integration.test.jsx — 在底部且可见时视窗计数派生为 0，而回执真相一字不改 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-217 | tests/timeline-reading-integration.test.jsx — 跳到最新在真正到达之前一字不清：意图改回跟随不等于在场 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-218 | tests/timeline-reading-integration.test.jsx — 兜底只认真实在场：浏览态、Surface 隐藏、页面不可见都不压计数 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-219 | tests/timeline-reading-integration.test.jsx — 页面不可见时兜底关闭，回到前台立刻恢复 | S19 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-220 | tests/timeline-render-authority.test.jsx — keeps a committed presentation choice on its committed channel without taking reading control | S20 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-221 | tests/timeline-row-measurement-revision.test.jsx — changes the per-row measurement signature when target authority or roster kind changes without changing row data | S21 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-222 | tests/timeline-row-measurement-revision.test.jsx — keys an agent.select row by the rendered describe labels, not only by capability word names | S21 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-223 | tests/timeline-row-measurement-revision.test.jsx — includes the presentation content revision used to reset a failed row boundary | S21 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-224 | tests/timeline-scope-incremental.test.js — 逐帧生长时,每一帧都与全量版相等 | S22 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-225 | tests/timeline-scope-incremental.test.js — 同一个 state 对象上持续追加(索引真的走增量路径) | S22 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-226 | tests/timeline-scope-incremental.test.js — 换了 selfId 就整张重建,恒不在别人的基线上继续加 | S22 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-227 | tests/timeline-scope.test.js — reaches the whole exchange from the one message I sent | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-228 | tests/timeline-scope.test.js — leaves an exchange that is not mine out | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-229 | tests/timeline-scope.test.js — keeps a whole conversation when any part of it is mine, and drops the ones that are not | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-230 | tests/timeline-scope.test.js — changes nothing under the全部 scope, and nothing when there is no self to scope by | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-231 | tests/timeline-scope.test.js — 增量索引在基线后只消费新行，不再每帧遍历 rows Map | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-232 | tests/timeline-scope.test.js — keeps the exact edit replacement candidate out until reciprocal handoff | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-233 | tests/timeline-scope.test.js — 终端命令在「@我」下不出现——我在终端里已经全程看着了 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-234 | tests/timeline-scope.test.js — 终端会话开关在「@我」下同样不出现 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-235 | tests/timeline-scope.test.js — 但在「全部」下照常可见——账本恒是完整的 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-236 | tests/timeline-scope.test.js — 恒不因为它而把整段对话捞进来 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-237 | tests/timeline-scope.test.js — 真实 timer fire、唤醒请求、进展和子请求都在 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-238 | tests/timeline-scope.test.js — peer 分页里的普通 self-audience 请求仍不算 timer | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-239 | tests/timeline-scope.test.js — 只有 timer 前缀不够，普通 self event 不获得归属 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-240 | tests/timeline-scope.test.js — 一旦同 correlation 有 human 边，自委托仍由二层闭包保留 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-241 | tests/timeline-scope.test.js — 普通 self-audience 请求仍在「全部」账本可见 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-242 | tests/timeline-scope.test.js — 人给自己发的不算委托——那条线走的是"我发/我收"，不受这条规则影响 | S23 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-243 | tests/timers.test.js — uses the real after field set | S24 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-244 | tests/timers.test.js — persists only browser-local timer records and transitions cancellation | S24 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-245 | tests/turn-presentation.test.js — summarizes business progress without flattening technical evidence into the main line | S25 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-246 | tests/ui-activity-overlay.test.jsx — 没操作过就什么都不显示 | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-247 | tests/ui-activity-overlay.test.jsx — 说清楚发生了什么,而不是只说"有个操作" | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-248 | tests/ui-activity-overlay.test.jsx — 没做成的操作要说出原因 | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-249 | tests/ui-activity-overlay.test.jsx — 最后一条之后一分钟自己消失 | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-250 | tests/ui-activity-overlay.test.jsx — 来了新的一条就重新计时 | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-251 | tests/ui-activity-overlay.test.jsx — 关掉就立刻消失,但下一条操作还会再出现 | S26 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-252 | tests/ui-primitives.test.jsx — 通过真实展开和点击选择值 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-253 | tests/ui-primitives.test.jsx — 支持方向键、Enter、Escape 和 disabled 选项 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-254 | tests/ui-primitives.test.jsx — 按实际标签数量渲染并支持方向键切换 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-255 | tests/ui-primitives.test.jsx — 无标签时仍只有一个明确滚动区 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-256 | tests/ui-primitives.test.jsx — FormField 关联 label、说明和错误 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-257 | tests/ui-primitives.test.jsx — PanelCard 支持语义元素而不拥有业务状态 | S27 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-258 | tests/ui-primitives.test.jsx — 进入时聚焦取消，Escape 取消并在卸载后返回焦点 | S27 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-259 | tests/ui-words-hook.test.jsx — ui.state 被受理并回一个带快照的 resolve | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-260 | tests/ui-words-hook.test.jsx — ui.navigate 真的调了切频道那个动作 | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-261 | tests/ui-words-hook.test.jsx — 重复渲染不会把同一条执行两次 | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-262 | tests/ui-words-hook.test.jsx — 执行途中重渲染,答案照样发得出去 | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-263 | tests/ui-words-hook.test.jsx — 换频道并指定视图:两样都要生效 | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-264 | tests/ui-words-hook.test.jsx — 点名别人的屏幕就完全不掺和 | S28 | **GAP** — no current consumer/owner; explicit product decision required |
| SZ-265 | tests/version-incompatible.test.jsx — explains that the old page stopped and exposes one explicit refresh action | S29 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-266 | tests/view-session.test.js — separates channel choices from filtered-view reading state | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-267 | tests/view-session.test.js — prevents an old activation from overwriting a newer A→B→A session | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-268 | tests/view-session.test.js — keeps a browsing bookmark only for this page session and starts a new page at latest | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-269 | tests/view-session.test.js — does not let a second page overwrite this page session position | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-270 | tests/view-session.test.js — uses revision compare-and-swap inside the current activation | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-271 | tests/view-session.test.js — does not forget unseen stable identities past the former 256-key boundary | S30 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-272 | tests/view-session.test.js — migrates viewport unseen state from finite records and discards legacy derived surplus | S30 | **BLOCKED** — retired storage/implementation shape retained pending explicit product/data ruling; current fact documented |
| SZ-273 | tests/view-session.test.js — drops count-only and key-only viewport unseen state at the storage boundary | S30 | **BLOCKED** — retired storage/implementation shape retained pending explicit product/data ruling; current fact documented |
| SZ-274 | tests/visual-interaction-contract.test.jsx — has one mature virtual-list geometry executor and no legacy engine | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-275 | tests/visual-interaction-contract.test.jsx — keeps reading intent free of DOM and network side effects | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-276 | tests/visual-interaction-contract.test.jsx — keeps Composer outside the fixed reading geometry contract | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-277 | tests/visual-interaction-contract.test.jsx — gives mobile keyboard geometry to one visual viewport owner | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-278 | tests/visual-interaction-contract.test.jsx — keeps async rich media inside stable first-paint boxes | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-279 | tests/visual-interaction-contract.test.jsx — keeps mobile channel navigation independent from the conversation grid | S31 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-280 | tests/waiting-closure-entry.test.jsx — keeps a matched live terminal across trim until an older in-flight page releases | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-281 | tests/waiting-closure-entry.test.jsx — releases the newer terminal visible-gap page before the older request page | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-282 | tests/waiting-closure-entry.test.jsx — drains one bounded reservoir newest-first across partial reveal segments | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-283 | tests/waiting-closure-entry.test.jsx — merges a concurrent live terminal before publishing its buffered replay page | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-284 | tests/waiting-closure-entry.test.jsx — uses IndexedDB pages in the same terminal-before-request order | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-285 | tests/waiting-closure-entry.test.jsx — merges a cached terminal into an already-materialized canonical request | S32 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-286 | tests/waiting-layout.test.jsx — does not install a size/mutation/frame observer or publish a scroll intent | S33 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-287 | tests/waiting-layout.test.jsx — keeps reading and focused Composer DOM identities across input and Waiting changes | S33 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-288 | tests/waiting-layout.test.jsx — keeps the floating stack separate from the reading subtree and preserves caller classes | S33 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-289 | tests/waiting-presentation.test.js — assigns a durable local agent request to Waiting before ledger position arrives | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-290 | tests/waiting-presentation.test.js — keeps newly accepted local requests after canonical queued positions | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-291 | tests/waiting-presentation.test.js — keeps a canonical queued fact visible while target authority is resolved elsewhere | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-292 | tests/waiting-presentation.test.js — keeps one stable id through local, landed-open, and canonical queued commits | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-293 | tests/waiting-presentation.test.js — never guesses that an unrelated open request is queued | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-294 | tests/waiting-presentation.test.js — releases local continuity when the canonical request starts running | S34 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-295 | tests/waiting-terminal-finality.test.js — R1：窗口摘掉已终态 turn 后，local echo 恒不把它复活进等待区 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-296 | tests/waiting-terminal-finality.test.js — R1b：continuity 也不能把窗口外的已终态请求留在等待区 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-297 | tests/waiting-terminal-finality.test.js — R2：没有精确 closure 时，Replica 不得把历史空洞里的 request 猜成已终态 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-298 | tests/waiting-terminal-finality.test.js — R2b：窗口从未装入过的更老请求仍可以是真的 queued（恒不过度声明） | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-299 | tests/waiting-terminal-finality.test.js — R3：窗口摘掉 request 行但 turn 因终态在窗口内而存活，历史页重装 request 恒不抹掉终态 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-300 | tests/waiting-terminal-finality.test.js — R3b：重装 request 恒不丢失已装入的进度帧与终态序号 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-301 | tests/waiting-terminal-finality.test.js — 未终态的请求恒不被归档误伤：开着的 turn 整段留在窗口内 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-302 | tests/waiting-terminal-finality.test.js — 精确 closure 被破坏后，human.approve 保守地重新成为待办 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-303 | tests/waiting-terminal-finality.test.js — 超过 512 条时仍保留每个 request id 的精确终态证明 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-304 | tests/waiting-terminal-finality.test.js — terminal 先于 request 的历史后缀超过 512 条时也不能丢精确保护 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-305 | tests/waiting-terminal-finality.test.js — 真实 history/live/trim 交错：非连续历史空洞里的 queued 恒不被区间压缩吞掉 | S35 | **OPEN** — retained; build public-owner successor or hand off regression |
| SZ-306 | tests/wire.test.js — sends attach as the first and only attach frame | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-307 | tests/wire.test.js — attaches immediately without waiting for local Replica metadata | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-308 | tests/wire.test.js — delivers live immediately while attach persistence remains unfinished | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-309 | tests/wire.test.js — rejects feed before the v5 attach receipt instead of emulating the old wire | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-310 | tests/wire.test.js — delivers explicitly correlated history rows after a metadata-only attach | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-311 | tests/wire.test.js — delivers only current-generation live scan checkpoints after attach | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-312 | tests/wire.test.js — reads an older page over the attached websocket | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-313 | tests/wire.test.js — checks one channel head immediately over the control lane | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-314 | tests/wire.test.js — cancels a correlated history batch without overloading request cancel | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-315 | tests/wire.test.js — correlates receipts and errors by ref | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-316 | tests/wire.test.js — uses a fresh cursor snapshot after reconnect | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-317 | tests/wire.test.js — reattaches immediately on mobile foreground wake even when the old socket still looks attached | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-318 | tests/wire.test.js — rejects every pending request on close | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-319 | tests/wire.test.js — stops once and requests a page refresh when a pre-v5 downstream frame arrives | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-320 | tests/wire.test.js — agent.ask 的 body 上盖着 origin | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-321 | tests/wire.test.js — 别的词一个字都不加——控制命令和 system 词都不盖 | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-322 | tests/wire.test.js — 已有的 origin 不覆盖——代转的消息来源是最先说话那块屏 | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-323 | tests/wire.test.js — 服务端没给 session 就不盖 | S36 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-324 | tests/work-items.test.js — 统一审批、回合、正式任务、恢复和本设备自动动作，且按原生编号去重 | S37 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-325 | tests/work-items.test.js — 只接受 describe 明确声明 task.create 的 provider | S37 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-326 | tests/work-items.test.js — task.create compact closure 稳定标成详情不可用，不猜成已完成普通回合 | S37 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-327 | tests/work-items.test.js — 过滤责任、状态和类型并保持自动动作独立分组 | S37 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-328 | tests/workspace-bootstrap-cache.test.js — restores the small identity, membership and profile manifest without mixing principals | S38 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-329 | tests/workspace-route.test.js — 编码并恢复频道、主视图和稳定 focus | S39 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-330 | tests/workspace-route.test.js — 拒绝未知视图和未知 focus，不猜测目标 | S39 | **GREEN** — current public-owner candidate passed in focused run or linked migration report |
| SZ-331 | tests/workspace-route.test.js — 写入 history 时区分普通导航与 Context 入口 | S39 | **OPEN** — retained; build public-owner successor or hand off regression |

## Product packets and handoff boundaries

Each packet below owns one user capability and one first divergence. The
StructuredResult packets are disjoint by protocol branch; the two successful
title probes remain mapped to baseline case SZ-025, while the failure label is
mapped to baseline case SZ-026. Outbox evidence is deliberately handoff-only
to `composer_owner`, so this ledger does not create a second product packet or
duplicate its assertions.

### Independent review of `8fb0ae8` stop-control boundaries

The public renderer gate is green for the affordance itself: `canInterrupt`
requires a writable member, a current roster/history authority containing the
single request audience, a latest queued/processing frame that advertises
`agent.interrupt`, and rejects terminal or local-echo turns. The focused owner
suite passed these cases.

The command owner is not equivalent to that renderer gate. `WorkspaceApp`
passes `submission.control` directly to the conversation port, while the
submission runtime exposes `control` as the generic `send` function. The
timeline callback supplies `{ type, actorId, turn, payload }`, but `send`
constructs the wire frame from `row.msgType`; this path therefore drops the
stop word instead of proving an `agent.interrupt` command. Independently, the
Composer interrupt command checks channel `canTransmit` and the static target
capability only; it does not re-check current processing state, current roster
authority, or terminal/local status. Thus the commit closes button visibility,
but a direct command call can bypass the stop semantic gate (and the timeline
button path has a `{type}`/`{msgType}` adapter mismatch). This is a command-owner
product handoff, not a renderer regression; no source change was made here.

Resolution in the follow-up product repair: `submission.control` now owns a
canonical command normalizer and the only private control admission path;
public `send` rejects raw `agent.*` control words. `agent.interrupt` requires
the active turn's queued/processing frame, declared interrupt word, matching
single audience, current roster authority, and non-terminal/non-local facts;
Composer direct calls without that context fail closed. Direct owner and
renderer-path tests now pass. The original finding remains recorded above as
the pre-fix evidence boundary.

### Ninth-round read-only recheck of `4b7e5e3`

Non-`interrupt` `agent.*` words (`steer`, `replace`, `compact`, `hold`, and
`dismiss`) normalize through the same owner without requiring an interrupt
turn context; they remain persistable while transport is closed and are still
fenced by member access, world/attempt owner, and transport generation at the
request-owner phases. `src/model/request-owner.js` and the current submission
owner suites passed the access/world/attempt checks.

The Waiting feature path has a separate boundary: when `item.targetAuthority`
is absent, `createFeatureWaitingControlSubmission` labels the source as
`feature`, and `assertInterruptContext` currently permits that source exception.
The Waiting capability stays visible, but the interrupt command is accepted
instead of failing closed on missing authority. This is an explicit follow-up
control-owner finding; no Workspace/control source was changed in this
read-only review.

| Packet | Scope (mutually exclusive) | Minimal repro/evidence | First public owner | Disposition |
|---|---|---|---|---|
| R-SZ-001 | Daemon directory projection never exposes declaration secrets. | `tests/space-administration.test.js`: public `accessRef.directory` receives `key: secret`. | `useWireConnection` accessRef.directory + governance ports | RED; baseline SZ-018 |
| R-SZ-002A | StructuredResult uses the protocol request type as the title for `system.channel.list`. | `tests/structured-result-restore.test.jsx`: completed `system.channel.list` result shows `system.channel.list`, not generic `结构化结果`. | `useTimelineRowRenderer` → public `TimelineRowRenderer` structured-result branch | GREEN; baseline SZ-025 branch fixed and direct owner-tested |
| R-SZ-002B | StructuredResult presents `actor.describe` with the actor capability title `codex 的能力`. | `tests/structured-result-restore.test.jsx`: completed `actor.describe` result shows `codex 的能力`, not generic `结构化结果`. | `useTimelineRowRenderer` → public `TimelineRowRenderer` structured-result branch | GREEN; baseline SZ-025 branch fixed and direct owner-tested |
| R-SZ-002C | StructuredResult maps `type_unsupported` to the user-facing failure wording `接收方不支持这个操作`. | `tests/structured-result-restore.test.jsx`: failed result with `error_code: type_unsupported` shows that label while retaining detail/redaction behavior. | `useTimelineRowRenderer` → public `TimelineRowRenderer` failure branch | GREEN; baseline SZ-026 fixed and direct owner-tested |
| R-SZ-005 | A processing turn shows 停止 only when the current public authority is writable and advertises `agent.interrupt`. | `tests/task-controls-restore.test.jsx`: no stop for missing control, stale access, or departed target; stop appears and dispatches only for current writable authority. This is an extra candidate and does not reopen the 9 GREEN S11 baseline cases. | `useTimelineRowRenderer` → public `TimelineRowRenderer` turn-controls branch | GREEN; extra owner suite passed |
| R-SZ-005B | The stop command owner must preserve the renderer's `agent.interrupt` type and re-authorize writable/current-capability/processing/non-local facts at dispatch time. | `tests/control-command-owner.test.jsx` and `src/model/control-command.test.js`: raw `send` and context-free Composer interrupt are rejected; canonical Timeline context emits one `agent.interrupt` frame; stale access/authority, terminal/local, and missing capability fail closed. | `useComposerSubmissionRuntime` canonical control owner, fed by `TimelineRowRenderer` | GREEN; follow-up owner repair and 21 focused control tests passed |
| R-SZ-006 | Terminal input typed before the shared stream is ready is buffered and delivered exactly once after ready; switching views must not silently drop the input. | Successor `tests/terminal-feature.test.jsx`: mounts public `TerminalFeature` with the `terminal-session` port, submits before the asynchronous handle and shared stream are ready, then asserts one post-ready input frame. | `TerminalFeature` + `terminal-session` | GREEN; minimal owner buffer repair and direct ready-path test passed |
| R-SZ-X01 | A committed pointer channel selection transfers focus to its heading without scrolling. | `tests/workspace-layout-channel-focus.test.jsx`: click c1, rerender, then heading is not focused. | `WorkspaceLayout` channel navigation/focus path | EXTRA RED; hand to owner |
| H-SZ-OUTBOX | Outbox reconnect hot-loop and feed-before-hydration resurrection are handoff-only; no duplicate product packet here. | Existing `tests/submission-outbox.test.jsx` repros: uncertain id sends 3 instead of 2; feed-before-hydration row remains after rerender. | `composer_owner`: `useComposerSubmissionRuntime` + `outbox-store` | HANDOFF ONLY; composer_owner owns triage/fix |

## Blocked implementation oracles

SZ-011, SZ-272, and SZ-273 remain **BLOCKED** rather than closed as obsolete.
They are retired storage/implementation-shape oracles retained until the root
channel receives an explicit product/data ruling. No current public owner is
claimed for these rows, and no test was deleted or skipped.

## Boundary

Only tests and this audit in S–Z/numeric scope were touched. Browser product behavior is not claimed green by this unit ledger.
