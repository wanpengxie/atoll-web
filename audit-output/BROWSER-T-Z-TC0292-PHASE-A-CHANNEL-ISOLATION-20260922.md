# Browser T–Z — TC-0292 / A-BR-04/05/06/07

Date: 2026-09-22
Claim base: `452ce50b23f66185cbd29f2ee0ae2625d408f5fa`

## Atomic claim and CAS precheck

This packet claims exactly one previously uncredited Browser T–Z baseline:

- numeric key: **TC-0292**;
- fae8b70 declaration: `tests/browser/phase-a.spec.js:35`;
- user label: `A-BR-04/05/06/07 多频道隔离、消息终态、审批与系统 Actor 隐藏`;
- central ledger row: `audit-output/TEST-CASE-MIGRATION-LEDGER.md:643`;
- current public owner boundary: `WorkspaceApp` → `WorkspaceLayout` / `ConversationSurface` / governance member projection / `ChannelFeedRuntime` and the existing timeline approval projection.

An exact-key/source search found no earlier dedicated TC-0292 claim or successor. The adjacent claims were excluded from this CAS: TC-0234 (I–M ThreadCall), TC-0235–0243 (E–H terminal), TC-0259 (S–Z jump/append), TC-0263 (A–D shell actions), TC-0264 (this T–Z Composer-menu claim), TC-0277 (E–H polling), and TC-0286–0290 (N–S performance). TC-0291 is a separate `phase-a.spec.js:18` declaration and is now claimed by the independent test-only candidate `35a69e4`; it is not part of this claim.

The legacy `tests/browser/phase-a.spec.js` present in the shared worktree is untracked material. It is evidence for the fae declaration only; this claim does not stage or modify it. The target path was absent at the migration target, so a future successor must be a new public browser spec rather than a hidden import or private-oracle wrapper.

## Preserved public contract

The successor must preserve the complete user-observable journey, without treating cache/IDB/source ordering or private diagnostics as a pass gate:

1. Reset the `multi-channel` fixture (seed `31`), sign in as `root`, and open `c0.project` from the channel rail.
2. Show the `c0.project` heading and its history while the `c0` root history is absent from the active main surface (channel scope isolation).
3. In the public Members panel, show `project-agent` and hide `system`, `registrar`, and `svcactor`.
4. Send a uniquely named message and observe that message plus the `PONG` response in the project surface.
5. Observe the approval card, approve it, and observe the receipt and `COMPLETED` terminal state.
6. Trigger the two public fixture pulses; show the project update while no `c0` update leaks into the active project surface.

Evidence must use public DOM and the public request/control boundary only. It must retain all isolation, terminal, approval, and actor-visibility assertions; no skip, timeout-only success, fixture timing shortcut, source inspection, or assertion weakening is allowed.

## Scope and status

This is the atomic ledger claim only. No product, vendor, package, fixture, or existing spec was changed. No browser result is claimed yet: the baseline target is absent and requires a dedicated successor before Chromium execution. Any successor and its audit must remain attributable to TC-0292 and must not absorb the separate TC-0291 login/root/lobby contract.
