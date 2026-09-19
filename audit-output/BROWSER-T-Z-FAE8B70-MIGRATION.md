# Browser T–Z / numeric migration ledger for `fae8b70`

This is the case-level ledger required by `f6cebbb`. The partition contains 10
baseline spec files and 38 baseline test cases; there are no numeric-leading
spec files. All 38 baseline cases were read. The old Waiting fixtures were not
restored: the replacement enters `WorkspaceApp` through the login surface.

Status at the latest runs:

- 38/38 cases have an executable current test (10 existing migrated specs, 14
  visual cases in `ui-visual.spec.js`, and 14 Waiting cases in
  `waiting-production-contract.spec.js`).
- The latest full browser behavior pass (including the canonical-history case)
  is 8 green / 2 red. UX-A01 remains red at the post-mount localStorage
  seeding seam: one run removed the stale chip but returned no rows, while an
  isolated rerun never exposed the chip. UX-A08 is red at the restored durable
  contract because the live arrival still writes no `unseenRecords` tuple.
  Neither result is evidence to weaken its case.
  The Waiting replacement is 13 green / 1 red after the Composer handoff guard
  and clamped-wheel fix; the remaining red is the browsing send takeover. The
  visual group is intentionally red against the preserved screenshot/geometry
  contract: the latest production run recorded all 14 red, including the
  missing global activity entry.
- The red cases are not skipped or weakened. They are regression packets for
  product/contract decisions. Mock-control HTTP `ok` checks are setup checks
  only; product assertions are made against the rendered production surface.
- No source hash, source-path fingerprint, React fiber read, private product
  journal, vendor/package change, compatibility selector, or fixture-only entry
  remains in the migrated target specs. The persistence case uses only the
  explicit opt-in reading trace as a black-box acknowledgement receipt.

## Case ledger

Each row records: user capability and invariant; current owner; original
setup → action → result; current evidence and disposition.

### `ui-visual.spec.js` (14 cases)

1. **UI-VIS-01 桌面三栏工作台视觉基线** — Capability: read the desktop rail,
   conversation, and composer as one three-column workspace. Invariant: reading
   remains above the composer and the input allocation is stable. Owner:
   `WorkspaceLayout`/`SurfaceShell`/`ConversationSurface` and shell CSS. Original:
   `multi-channel` seed 901 → login at 1280×720 → surface geometry and masked
   screenshot. Current: the migrated production test reaches the real surface;
   the contract reports a 30px reading/stack gap where the preserved baseline
   requires 32px. **RED: layout regression packet.**

2. **UI-VIS-02 频道管理 概览 视觉基线** — Capability: open channel governance
   and inspect the overview tab. Invariant: the panel is modal/context-owned,
   tabbed, and visually stable. Owner: `ChannelAdministrationPanel`/`SidePanel`.
   Original: `actor-governance` seed 902 → channel menu → `频道详情` → overview
   screenshot. Current: migrated to public `频道治理` and `概览` roles; panel
   opens, but the preserved screenshot differs by 10%. **RED: visual contract
   packet; no test masking added.**

3. **UI-VIS-02 频道管理 成员 视觉基线** — Capability: inspect the channel
   roster. Invariant: member controls stay inside the governance panel. Owner:
   `ChannelAdministrationPanel`/`ChannelMembers`/`SelectMenu`. Original:
   same scenario/seed → `成员` tab → screenshot. Current: public tab reaches
   `频道治理`; screenshot differs by 11%. **RED: visual regression packet.**

4. **UI-VIS-02 频道管理 危险操作 视觉基线** — Capability: reach protected
   retirement controls without accidentally retiring the root. Invariant:
   dangerous action remains explicitly gated. Owner: `ChannelDanger`.
   Original: same scenario/seed → `危险操作` tab → screenshot. Current: public
   tab reaches; screenshot differs by 1% (still over the 10-pixel contract).
   **RED: visual regression packet.**

5. **UI-VIS-03 新建频道独立任务视觉基线** — Capability: start child-channel
   creation from the rail. Invariant: creation is an explicit governance form,
   not an invented task/dialog. Owner: `WorkspaceLayout` →
   `ChannelAdministrationPanel`/`ChannelOverview`. Original:
   `channel-governance` seed 907 → `新建频道` → old dialog/template screenshot.
   Current: migrated to the real `频道治理` `创建子频道` form and public
   `频道模板` control; the preserved screenshot remains red. **RED: visual
   contract packet; old dialog selector was not retained.**

6. **UI-VIS-04 空间管理视觉基线** — Capability: open space administration and
   inspect template/device tabs. Invariant: context panel owns focus and its
   tabs stay reachable. Owner: `SpaceAdministrationPanel`/`SidePanel`.
   Original: `space-administration` seed 903 → `空间管理` → screenshot. Current:
   public panel opens; screenshot differs by 5%. **RED: visual regression
   packet.**

7. **UI-VIS-06 定时动作视觉基线** — Capability: open the Tasks view and arrange
   an automation. Invariant: only the browser-session receipt boundary is shown;
   no cross-device list is fabricated. Owner: `TasksFeature` →
   `ChannelAutomationPanel`. Original: `scheduled-action` seed 905 → `任务` →
   `安排自动动作` → screenshot. Current: public panel opens; screenshot differs
   by 7%. **RED: visual regression packet.**

8. **UI-VIS-07 850px 频道管理抽屉视觉基线** — Capability: use governance at
   850px without losing the workspace. Invariant: responsive context panel does
   not create horizontal overflow. Owner: `useSurfaceTopology`/`SidePanel`.
   Original: `actor-governance` seed 905 → 850×720 → members panel screenshot.
   Current: public panel opens; preserved screenshot is red. **RED: responsive
   visual packet.**

9. **UI-VIS-08 600px 选择用户菜单视觉基线** — Capability: choose a participant
   on a narrow screen. Invariant: the listbox stays within the panel and remains
   reachable. Owner: `ChannelMembers`/`SelectMenu`. Original:
   `actor-governance` seed 906 → 600×720 → members → participant combobox →
   listbox screenshot. Current: the public combobox/listbox path reaches the
   listbox at 600×720; the preserved screenshot differs by 4%. **RED:
   responsive visual regression packet; no environment block.**

10. **UI-VIS-09 用户消息与 Agent 答案气泡视觉基线** — Capability: read a user
    request and Agent answer without horizontal clipping. Invariant: all owned
    content and controls fit the reading viewport. Owner:
    `ConversationSurface`/`VendorListExecutor`/`TimelineRowRenderer`. Original:
    `actor-capability` seed 908 → wheel into history → request/answer row →
    geometry and screenshot. Current: public row and horizontal containment
    checks run; screenshot is 958×219 instead of the preserved 958×180. **RED:
    message-bubble visual packet.**

11. **UI-VIS-10 全局活动中心视觉基线** — Capability: open a cross-channel global
    activity center. Invariant: activity and operation tabs expose only readable
    live facts. Owner in the old product: global activity panel; current owner:
    none (current `WorkspaceLayout` exposes rail timers, not this entry). Original:
    `approval-schema` seed 909 → `打开活动中心` → panel screenshot. Current:
    production surface has no public `打开活动中心` button and times out.
    **RED: product capability gap; do not add a test-only button.**

12. **UI-VIS-11 600px 全局搜索视觉基线** — Capability: search visible channels,
    messages, files, tasks, and members on a narrow screen. Invariant: modal
    focus/width stays inside the viewport. Owner: `SearchFeature`/`useModalFocus`.
    Original: `multi-channel` seed 910 → mobile rail → global search → fill
    `history 1` → screenshot. Current: public dialog/focus path runs; screenshot
    differs by 5%. **RED: visual regression packet.**

13. **UI-VIS-12 频道挂载文件主页面视觉基线** — Capability: upload and view a
    file in the channel-mounted directory. Invariant: file rows and controls stay
    in the Files region; no retired history-edge DOM is manipulated. Owner:
    `FilesFeature`/attachment transaction owner. Original: `resource-workflow`
    seed 911 → Files → upload `频道交付说明.txt` → screenshot. Current: upload
    and public Files region pass; preserved screenshot differs by 1%. **RED:
    visual regression packet.**

14. **UI-VIS-13 频道挂载文件预览视觉基线** — Capability: select a Markdown file
    and read its preview alongside the channel. Invariant: preview context does
    not move the conversation/composer allocation. Owner: `FilesFeature` →
    `ArtifactPreviewPanel` plus `ConversationSurface`. Original:
    `resource-workflow` seed 912 → Files → upload/select Markdown → detail text,
    geometry, screenshot. Current: public preview/text path runs; surface gap is
    30px versus preserved 32px and screenshot is red. **RED: layout + visual
    packet.**

### `unseen-following-timeline.spec.js` (1 case)

15. **following physical tail never exposes a transient unseen prompt while the
    committed row is visible** — Capability: at physical tail, a user-sent
    canonical arrival is immediately readable without a jump notice. Invariant:
    following mode stays at the tail and no unseen button overlays it. Owner:
    `useConversationProjection` + `useLiveArrivalReceipts` +
    `VendorListExecutor`/`ConversationSurface`. Original: `deep-history` seed
    `0x922801` → login at tail → send steward probe → frame-capture and old
    diagnostic `reading.unseen-arrival` journal. Current: send the same user
    path, assert the probe text is visible, sample rendered row visibility/gap/
    jump only, and attach frame transitions. **PASS.** The retired journal was
    an implementation oracle, not a user capability; it is not reintroduced.

### `ux-reading-evidence.spec.js` (5 cases)

16. **UX-A09 covered Surface keeps arrival unseen until a fresh visible materialized-tail observation** — Capability: an arrival while Files covers the compact conversation is not acted on by an invisible reader; reopening returns to canonical history. Invariant: hidden content cannot manufacture a viewport notice. Owner: `WorkspaceLayout` surface visibility + `ConversationSurface`/history consumer. Original: mobile `multi-channel` seed 29101 → open Files → `push_terminal` → expect hidden materialization and one jump → reopen/ack. Current: canonical `approval` arrival → hidden pane has no jump → reopen sees `Approve live mock action` at tail with no stale jump. **PASS.**

17. **UX-A09 an old channel activation cannot consume or publish unread state in the committed channel** — Capability: unread state belongs to the active channel and returns with that channel. Invariant: switching away clears the inactive view and switching back restores only its own notice. Owner: `useChannelNavigation`/`WorkspaceLayout` + per-channel `useConversationProjection`. Original: `multi-channel` seed 29103 → wheel c0 up → `push_terminal` → switch `c0.project` → return c0. Current: canonical approval and public `.channel-item` activation are used; the targeted rerun after `effc8f0` reaches both headings and preserves the channel-owned notice. **PASS after product guard; the prior Tiptap/`feed.disconnectHistory owner 尚未连接` failure is retained in history, not hidden.**

18. **UX-A09 history, replay, reconnect, filters and channel switches never manufacture viewport unseen** — Capability: history admission, duplicate replay, reconnect, filters, hidden surface, and channel switches do not invent a jump. Invariant: only a real active-channel unseen arrival can show the notice. Owner: `channel-replica`/history consumer + `useConversationProjection` and navigation. Original: `multi-channel` seed 29105 → dense history → terminal/replay → filter on/off → Files hidden → dense progress → drop/reconnect → switch channels. Current: dense canonical approval/replay and public filter/Files/reconnect evidence run; the targeted rerun after `effc8f0` completes the final channel switch without publishing a stale jump. **PASS after product guard; no selector weakening.**

19. **UX-A01 stale exact-incarnation filter remains named and removable** —
    Capability: a stale actor identity remains an explicit applied filter until
    the reader removes it. Invariant: roster refresh may not silently remap the
    identity. Owner: `useTimelinePreferences` + actor-filter presentation.
    Original: seed 29102 → inject old schema-2 ViewSession filter → reload →
    inspect/remove stale filter. Current: seed schema 3 (the live persisted
    contract), reload, use public stale filter button/`aria-pressed`, remove it,
    and assert rows return. The preceding run observed the stale chip and then
    removed it, but the post-remove rendered row set was empty; an isolated
    rerun instead timed out before the stale chip appeared while the same
    history rows were already visible. **BLOCKED as a migration/setup race:
    seed the v3 preference before the live ViewSession owner mounts, then
    re-run; do not weaken the row-return assertion.**

20. **UX-A06 selecting a settled member filters and acknowledges without a second control** — Capability: clicking a settled member both selects the filter and acknowledges that member’s activity. Invariant: no separate acknowledgement button appears and list identity/mode stays stable. Owner: actor filter in `ConversationSurface`/activity projection. Original: `long-running` seed 29104 → send mention → advance 3 → settled member button → click. Current: same production composer/advance path; public activity classes, `aria-pressed`, row identity, and absence of `.agent-activity-ack` are asserted. **PASS.**

### `ux-unseen-persistence.spec.js` (1 case)

21. **reload normalizes malformed unseen around valid sequence records, then verified latest clears exactly those records** — Capability: a browsing reader retains durable exact unseen evidence across reload, and the verified latest action clears precisely that evidence. Invariant: storage normalizes duplicate/invalid records, the jump reflects one valid record, and acknowledgement leaves no record behind. Owner: `view-session` persistence + `useConversationProjection`/`ConversationSurface` reading owner. Original: deep-history seed 29109 → wheel up → `pulse` → inspect durable `unseenRecords` → inject duplicate/invalid records → reload → jump-latest → assert normalized tuples and black-box visible-row acknowledgement. Current: canonical `approval` arrival, public `view-session.v3` storage, rendered jump/mode/physical gap, and opt-in read trace; no legacy owner helper or source internals. **RED: product persistence gap at the first result boundary** — after the visible approval jump, `readingState().value.unseenRecords` is `[]` instead of one finite sequence-backed tuple (`ux-unseen-persistence.spec.js:91`). The test retains the subsequent normalization, reload, jump-clear, and ack assertions for when the owner writes the contract; no test-only seed or soft fallback hides the missing write.

### `visible-unseen-ack.spec.js` (2 cases)

22. **wheel-visible committed arrival auto-acknowledges before exact physical tail** — Capability: a reader approaching (but not reaching) the tail can expose the arrival and have it acknowledged. Invariant: the row is visibly hit-owned, gap remains positive, and the jump disappears only after exposure. Owner: `useLiveArrivalReceipts` + `ConversationSurface`/WaitingLayer and reading geometry. Original: deep-history seed `0x922401` → wheel up → `pulse` → jump → wheel to 12px → geometry/evidence. Current: canonical `approval` arrival and public row/hit/overlap geometry. **PASS.**

23. **Waiting-covered committed arrival remains unseen until actually exposed** — Capability: a Waiting overlay prevents a covered arrival from being acknowledged. Invariant: overlap is owned by Waiting and the notice remains until the reader exposes it. Owner: `WaitingLayer` + `useLiveArrivalReceipts`/reading owner. Original: long-running-history seed `0x922402` → active + queued sends → wheel up → `pulse` → wheel to 70px → assert jump/Waiting overlap. Current: same real composer setup with canonical approval and public jump/row/Waiting hit geometry. **PASS.**

### `waiting-canonical-history.spec.js` (1 case)

24. **completed root-safe history pages never add canonical Waiting turns** —
    Capability: browsing completed history never invents an active Waiting task.
    Invariant: no Waiting region appears while history pages are admitted. Owner:
    `channel-replica`/history consumer + `useWaitingEditingController`.
    Original: long-running-history seed `0x921701` → capture wire history/page-end
    frames and inspect Timeline React state while wheeling 10 pages. Current:
    real login/scroll, public `频道动态`/history text, and zero visible `等待区`
    assertions; private wire/fiber probes were removed. **PASS.**

### `waiting-handoff.spec.js` → `waiting-production-contract.spec.js` (3 cases)

25. **queued request hands off once to a rapidly completed canonical row without duplicate semantics** — Capability: a queued request becomes one completed canonical row. Invariant: Waiting disappears and exactly one matching row remains. Owner: `useWaitingHandoff`/`WaitingLayer` + `channel-replica` canonical turn. Original: long-running-canonical seed `0x921801` → owner send, target queue, advance 3, `push_terminal`, replay envelope → inspect handoff animation/probe. Current: same production composer/advance/terminal path; public row count and Waiting absence. **PASS.**

26. **browsing-up handoff stays offscreen, preserves its anchor, and cleans up on channel exit** — Capability: a browsed reader keeps its anchor while a queued task completes and leaving the channel cleans Waiting. Invariant: no hidden handoff writes the browsing position. Owner: `ReadingContainerHandoff` + `useBrowsingReadingController`/navigation. Original: long-running-history seed `0x921802` → queue → wheel up → advance/terminal → switch c0.project. Current: the targeted rerun after `effc8f0` preserves the anchor and mounts `c0.project`; the earlier owner-disconnect/Tiptap failure is retained as the fixed regression history. **PASS after product guard.**

27. **reduced motion performs the same semantic handoff without transition state** — Capability: reduced-motion users receive the same completed row and no transition animation. Invariant: semantic owner is singular; visual animation is absent. Owner: `useWaitingHandoff` + CSS reduced-motion rules. Original: reduced-motion context → long-running-canonical seed `0x921803` → queue → advance 3 → inspect handoff probe. Current: emulate reduced motion after production queue exists, complete terminal, assert row/Waiting semantics and zero `waiting-handoff` animations. **PASS.**

### `waiting-layout.spec.js` → `waiting-production-contract.spec.js` (4 cases)

28. **Waiting and status facts never change the fixed reading or Composer allocation** — Capability: status/Waiting facts can change without moving reading or composer slots. Invariant: reading, stack, input, and composer rectangles are stable. Owner: `ConversationSurface` + `WaitingLayer`/`ConversationInput` geometry. Original: fixture `waiting-layout.html` → transition queued/partial/roster/edit/running/terminal/offline/queued/open → 16-frame geometry. Current: real app seed `0x921811`, owner+queued sends, collapse/expand, public rects and 48px reserve. **PASS.**

29. **input growth and clear stay inside the overlay while reading client geometry is constant** — Capability: multiline editing grows inside the composer and clearing returns it without moving reading. Invariant: editor owns overflow and reading geometry is constant. Owner: `Composer`/`ConversationSurface`. Original: fixture transition lines 1→6→clear/queued → rect and transition-attribute assertions. Current: real editor multiline fill/clear and public client/scroll geometry. **PASS.**

30. **short mobile-style Surface keeps focus and makes oversized Composer internally scrollable** — Capability: a short mobile viewport keeps keyboard focus and lets oversized input scroll internally. Invariant: no page overflow; send remains reachable. Owner: `SurfaceShell` topology + `Composer`. Original: fixture root height 300 → 24 lines → focus/overflow/hit geometry. Current: production 390×500, real editor, public focus/overflow/page-width/send geometry. **PASS.**

31. **production Timeline keeps queued to running to terminal outside the fixed geometry** — Capability: queue/running/terminal lifecycle does not resize the reading allocation. Invariant: the same geometry remains through terminal cleanup. Owner: `channel-replica`/`WaitingLayer`/`ConversationSurface`. Original: fixture `waiting-timeline.html` transitions queued/partial/roster/running/terminal. Current: real long-running-canonical app, advance + terminal, row text and Waiting absence plus public rects. **PASS.**

### `waiting-obstruction.spec.js` → `waiting-production-contract.spec.js` (3 cases)

32. **following keeps a fixed Waiting reserve through mount, controls and handoff** — Capability: Following mode keeps a 48px reserve while Waiting mounts and collapses/expands. Invariant: reserve and reading allocation are fixed. Owner: `reading-geometry.js` + `WaitingLayer`/`ConversationSurface`. Original: long-running scenarios and DOM writer/animation probe. Current: production queue, public collapse/expand and reserve/rect assertions. **PASS.**

33. **browsing keeps its anchor while the fixed Waiting reserve stays unchanged** — Capability: browsing up does not move its semantic anchor when Waiting appears. Invariant: same visible row/top and 48px reserve. Owner: `useBrowsingReadingController` + `WaitingLayer`. Original: establish owner/queue → wheel takeover → probe anchor/writers. Current: queue before trusted wheel, public row anchor and geometry; **PASS** after matching the original setup order.

34. **reduced motion uses the same fixed Waiting reserve without hidden controls** — Capability: reduced-motion Waiting remains usable without hidden duplicate controls. Invariant: reserve is 48px and the visible collapse control is singular. Owner: `WaitingLayer` + reduced-motion CSS. Original: reduced-motion scenario → queue → probe reserve/semantic controls. Current: emulate reduced motion after queue, public reserve/control counts. **PASS.**

### `waiting-send-transaction.spec.js` → `waiting-production-contract.spec.js` (4 cases)

35. **real App send transaction keeps queued WaitingLayer out of following-at-bottom geometry** — Capability: send at the tail leaves the canonical row readable and Waiting out of the input allocation. Invariant: tail gap ≤24 and reading rect stable. Owner: `useComposerSubmissionRuntime`/outbox + `ConversationSurface`/`WaitingLayer`. Original: real App owner send → probe clear/queued transaction and scroll writers. Current: public send, row text, rect and tail evidence. **PASS.**

36. **real App send transaction keeps queued WaitingLayer out of following-multiline-clear geometry** — Capability: multiline send clears without a layout jump. Invariant: reading rect remains stable and tail is followed. Owner: `Composer`/submission runtime + reading geometry. Original: multiline Shift+Enter send → probe input transition/writers. Current: production multiline editor and public rect/tail evidence. **PASS.**

37. **real App send transaction keeps queued WaitingLayer out of following-existing-waiting geometry** — Capability: sending while another task waits does not cover the composer or move reading. Invariant: existing Waiting remains visible and reading allocation stable. Owner: `WaitingLayer` + submission runtime. Original: existing waiting queue → send → probe controls/geometry. Current: production owner+queued setup then send and public Waiting/rect/tail evidence. **PASS.**

38. **real App send transaction keeps queued WaitingLayer out of wheel-takeover-after-send geometry** — Capability: send after trusted wheel takeover preserves browsing ownership and anchor. Invariant: send must not silently force Following or perform a competing programmatic scroll. Owner: `useBrowsingReadingController` + submission runtime/reading command executor. Original: wheel takeover → send → instrument scroll writers/anchor. Current: production wheel then send; public result gap was 0 (Following) instead of the required browsing gap >1. **RED: product regression packet; no forced test pass.**

## Follow-up: durable unseen result ownership (read-only)

The persistence migration was previously weakened to assert only that reload
starts at Following and ignores stale hints. That removed the product results
that make the durable unseen contract observable. The corrected spec restores
the exact-sequence tuple normalization (`unseenRecords`/`unseenKeys`/count),
reload jump restoration, jump-latest clearing, physical-tail convergence, and
black-box acknowledgement evidence from the public opt-in reading trace. It
uses current schema-3 localStorage and the public approval arrival; it does not
reintroduce the old reading-owner helper, React/fiber probes, or source-path
assertions.

Targeted run: `ATOLL_TEST_WEB_PORT=15279
ATOLL_TEST_MOCK_PORT=19838 npx playwright test
tests/browser/ux-unseen-persistence.spec.js`; **1 red** at line 91, where the
live approval is visible and the jump is present but the persisted reading has
zero `unseenRecords`. Source read-only audit shows `view-session` can normalize
such records, while `persistentReadingSession()` emits only mode/bookmark and
the live-arrival/ack owner never supplies durable unseen records. Ownership is
the reading persistence/arrival acknowledgement product path, not a migration
fixture. The remaining assertions are intentionally left hard and unskipped so
the product gap cannot be mistaken for a passing reload contract.

## Follow-up: actor-control payload ownership (read-only)

The architecture guard is a real current product gap, distinct from the four
browser trajectory cases above. The old `fae8b70` behavior is unambiguous:
`src/model/task-controls.js` merged an actor-provided entry payload over a
caller fallback, `src/ui/Timeline.jsx` supplied `{ target: context.requestId }`
for generic controls, and `task-controls.work.test.js` explicitly locked this
legacy no-payload fallback. The current `useWaitingEditingController` still
implements the same shape at `controlPayload()` and the generic button at its
WaitingLayer.

The correct post-`fae8b70` owner contract is stricter. The subtractive audit's
B5 target says an actor-authored control payload is mandatory; missing payload
must make the control unavailable, never reconstruct an older request shape.
The current feature owner already demonstrates the intended boundary:
`createFeatureWaitingControlSubmission()` only constructs the known `steer` /
`interrupt` requests and throws for an unowned control word; `WorkspaceApp`
passes that typed request to the single `submission.control` owner, whose
outbox frame preserves the supplied payload unchanged.

Minimal red example (no product edit made): use a queued turn `r-1` whose
latest progress declares `controls: [{ word: 'agent.retry' }]` with no
`payload`, render `WaitingLayer` as a writable member with current actor
authority, then click `retry`. The current callback is
`onTaskControl(turn, 'agent', 'agent.retry', { target: 'r-1' })`. Under B5 the
button must be unavailable (or the owner must reject it); it must never receive
the fabricated target. This is a **product ownership gap** at the generic
Waiting control boundary (`useWaitingEditingController` → `submission.control`);
it is not a reason to weaken the migrated browser cases. The fix belongs to
the Waiting/feature control owner, not to a T–Z test or fixture.

The four post-fix targeted trajectories were run with unique mock/web ports:
the two UX-A09 channel-switch cases and Waiting case 26 now pass; Waiting case
38 still fails at `waiting-production-contract.spec.js:298` with
`after.list.gap === 0`. Reproduction is `long-running-history`, seed
`0x92_18_38` (the helper computes `0x92_18_30 + 'browsing'.length`), viewport
1120×760: login at tail, hover `.timeline-message-list`, wheel `-900` until
`data-viewport-mode="browsing"`, send `send browsing`, then assert the public
tail gap remains `>1`. Current send handoff owns Following/tail instead. The
minimal owners are the Composer submission/reading-intent handoff and the
reading command executor; no test-only scroll writer was added.

## Follow-up: strict Reading/notification oracle re-verification at `6060588`

The `61c8758` UX-A08 contract is unchanged and was re-run independently:

```text
ATOLL_TEST_WEB_PORT=15282 ATOLL_TEST_MOCK_PORT=19841 npx playwright test \
  tests/browser/ux-unseen-persistence.spec.js \
  --reporter=line --output=test-results-browser-tz-a08-rerun-20260920
```

Result: **1 red**, line 91 (`unseenRecords` expected one finite tuple, received
`[]`). The public approval row and `↓ 1 条新动态` jump are present before the
assertion, so this is not an arrival or selector/environment failure. The hard
normalization → reload → jump-clear → ack assertions remain after the first
missing product write; no seed/fallback was added.

The notification owner-chain oracle from the adjacent N–S partition was also
re-run against the same current HEAD without changing that test:

```text
ATOLL_TEST_WEB_PORT=15281 ATOLL_TEST_MOCK_PORT=19840 npx playwright test \
  tests/browser/notification-owner-oracle.spec.js \
  --reporter=line --output=test-results-browser-tz-notification-owner-oracle-20260920
```

Result: **7/7 observation tests completed** (green means the chain snapshot was
collected, not that the product contract passed). The strict first-divergence
oracle is stable and assigns the next owner without guessing:

| case | first divergence at current HEAD | strict evidence | owner handoff |
|---|---|---|---|
| N2 | rail | following `gap=0`; related badge frames transiently `1 → 3 → 0`; cursor notification high-water 36 and replica max seq 36 are already present | presented-follow receipt → notification rail |
| N4 | rail | filtered input cursor high-water 63 and replica max seq 63; public rail has no channel/authority | filtered boundary → rail authority |
| H1 | rail | future-ack cursor high-water 30, replica head 32; public rail high-water 0 vs expected 28 | reload/future receipt → rail projection |
| H2 | rail | hydrated second reload cursor high-water 29, replica head 29; public rail remains absent/high-water 0 vs expected 27 | hydration → rail authority |
| H3 | rail | filtered-tail cursor high-water 29, replica head 29; public rail remains absent/high-water 0 vs expected 27 | filtered tail → rail authority |
| H4 | rail | following arrival cursor high-water 28, replica head 28; public rail high-water 0 vs expected 1; reading trace contains only `trace.enabled` | presented-follow → rail high-water |
| F7 | presentation | replica contains target `c0-history-request-112` (head 848, 80 cached rows), but the sole reading owner returns a different visible range after channel switch | reading-session/admission → virtualized presentation |

Waiting case38 was independently re-run after the same HEAD:

```text
ATOLL_TEST_WEB_PORT=15283 ATOLL_TEST_MOCK_PORT=19842 npx playwright test \
  tests/browser/waiting-production-contract.spec.js \
  --grep "wheel-takeover-after-send" --reporter=line \
  --output=test-results-browser-tz-waiting-case38-rerun-20260920
```

Result: **1 red** at `waiting-production-contract.spec.js:298`:
`after.list.gap === 0` where browsing requires `> 1`. Repro remains
`long-running-history`, seed `0x92_18_38`, 1120×760: login at tail → trusted
wheel `-900` → public browsing mode → send `send browsing` → inspect public
geometry. This is the Composer/reading-intent handoff plus reading command
executor owner boundary; the browser contract stays hard.

## Follow-up: commit-boundary recheck (`77760c8` → current HEAD `868abe6`)

The strict UX-A08/case38 contracts were compared before running:

```text
git diff 61c8758 HEAD -- \
  tests/browser/ux-unseen-persistence.spec.js \
  tests/browser/waiting-production-contract.spec.js
```

The target spec diff is empty: the `61c8758` hard checks remain intact,
including live finite `unseenRecords`, duplicate/invalid-record normalization,
reload jump text, exact tuple persistence, jump-clear empty records, and
visible-row acknowledgement; case38 still requires browsing `gap > 1` at line
298. No product change was staged or made by this recheck.

Each commit was run in its own detached worktree with independent ports, using
only the two strict cases:

| revision | UX-A08 durable unseen | Waiting case38 | disposition |
|---|---|---|---|
| `77760c8` | RED at line 91: visible approval/jump, then `unseenRecords=[]` | RED at line 298: `after.list.gap=0` vs `>1` | same product gaps; this historical worktree also logged a recoverable React `ReferenceError: controller is not defined` during mount |
| current HEAD `868abe6` (product parent `07ed014`) | RED at line 91: visible approval/jump, then `unseenRecords=[]` | RED at line 298: `after.list.gap=0` vs `>1` | same strict results; no environment timeout or selector fallback |

Commands used for both revisions were the equivalent of:

```text
ATOLL_TEST_WEB_PORT=<isolated> ATOLL_TEST_MOCK_PORT=<isolated> \
npx playwright test tests/browser/ux-unseen-persistence.spec.js \
  tests/browser/waiting-production-contract.spec.js \
  --grep "reload normalizes durable unseen|wheel-takeover-after-send" \
  --reporter=line
```

The unchanged red outcomes across the commit boundary strengthen ownership:
UX-A08 remains Reading persistence/arrival acknowledgement, and case38 remains
Composer/reading-intent handoff plus the reading command executor. Neither is a
migration artifact, so neither assertion is relaxed.

## Follow-up: historical `controller is not defined` first divergence

The extra error logged by the clean `77760c8` worktree is a source-level
product defect, not a browser fixture or migration selector. The first
unresolved identifier is:

```text
src/ui/timeline/useConversationProjection.js:735
  }, [state.channelId, controller.activationID, messageListKey]);
```

At that revision, `controller` is declared only inside the nested
`useProjectionReadingOwner()` owner (`useConversationProjection.js:134`); the
outer `useConversationProjection()` scope has only the returned `viewport`
(`useConversationProjection.js:582–591`). React evaluates the dependency array
during the outer render, before the cleanup can run, so the dereference throws
immediately. The browser call chain is:

```text
WorkspaceApp → ConversationSurface → useConversationProjection
  → dependency-array evaluation → ReferenceError
  → React root onUncaughtError → diagnostics react.uncaught
```

The stack observed in the historical run resolves to
`useConversationProjection.js:727:3` after Vite's source mapping. The minimal
owner correction landed separately in `07ed014`: it changes only that teardown
dependency to `viewport.activationID`, which is the value actually owned by the
outer hook. The current clean HEAD strict pair no longer logs this error; no
test-side workaround was added.

No newer notification/Reading product commit has landed after `07ed014` in the
current working session. The remaining uncommitted Reading owner edits are
deliberately excluded from the commit-boundary result; once their product
commit lands, rerun the unchanged UX-A08 and case38 commands above with fresh
isolated ports. Their hard RED contracts remain in force.

## Current files changed in this partition

- `tests/browser/ui-visual.spec.js` (current public governance/files selectors;
  no old dialog/fixture path)
- `tests/browser/waiting-production-contract.spec.js` (14 production-entry
  replacements for the deleted Waiting cases)
- `tests/browser/unseen-following-timeline.spec.js`
- `tests/browser/ux-reading-evidence.spec.js`
- `tests/browser/ux-unseen-persistence.spec.js` (restored durable unseen
  normalization, reload, jump-clear, and acknowledgement result contract)
- `tests/browser/visible-unseen-ack.spec.js`
- `tests/browser/helpers/profile-cold-entry.mjs`
- `tests/browser/reading-owner.js`
- this report

No `tests/browser/fixtures/waiting-*` file was added or used, and no product
source was changed.
