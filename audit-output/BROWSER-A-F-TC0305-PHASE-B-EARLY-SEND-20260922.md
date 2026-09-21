# Browser A–F — TC-0305 / B-BR-06a roster-not-ready early send

## Atomic claim

- **Case:** `TC-0305` / `B-BR-06a`.
- **Baseline:** `fae8b70:tests/browser/phase-b.spec.js:294` —
  `B-BR-06a 名册未就绪的早发送明确受阻，目标到达后原草稿可发送`.
- **Current base:** `d054696b8cdc84ea24970f4c7469517e0604439f`.
- **Branch:** `codex/browser-af-tc0305-d054696`.
- **Worktree:**
  `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.tmp-browser-af-tc0305-d054696`.

This is one previously uncredited A–F browser declaration. Only this report
and the eventual dedicated `tests/browser` successor/fixtures may change;
product source, vendor, package/lock files, and existing tests are out of
scope.

## Public user contract

When the roster/OBS is deliberately delayed, an early user send is visibly
blocked rather than submitted without a target: the original draft remains in
the Composer and no `agent.ask` submit is emitted. Once the public Agent
chooser receives its target, the user can select `steward`, send the retained
draft exactly once, and observe `PONG`. The successor uses only public
Composer text, roles, and the real chooser/send controls; websocket frames are
used only as the public transport-side negative check required by the old
contract, not as a private product oracle.

## Exact uniqueness precheck

1. The migration ledger has one retained `TC-0305` row for the baseline above;
   its target path is absent and remains static/unverified.
2. Exact searches across current refs, registered worktrees, audit reports,
   and browser specs found no prior `TC-0305`, `B-BR-06a`, successor, branch,
   or commit claim. TC-0304/B-BR-06 covers receipt/feed order after a target
   exists; TC-1207 covers a distinct Composer receipt-first contract. Neither
   covers roster-not-ready early-send preservation.
3. The old declaration has a strict two-phase user path: rejected early send
   with unchanged draft, then one accepted send after target arrival. The
   successor retains both phases and does not replace them with a ready-state
   smoke.

## Verification plan

The dedicated successor will reset the existing `feed-delayed` scenario,
delay only public OBS delivery through the existing mock control, clear the
product cache, reload, and attempt a send before a target is available. It will
assert the visible blocking message, zero `agent.ask` submit frames, and the
unchanged draft. It will then use the public chooser after the delayed roster
arrives, send the retained draft, and assert one submit plus visible `PONG`.
Chromium repeat evidence and `npm run build` will be appended here. Any first
public divergence will be reported to the existing Composer/roster owner; no
product or assertion weakening is authorized by this claim.

**Reservation status:** claimed; no product change is authorized by this
report.

## Closeout evidence

- Reservation commit: `2f551849d989acc82413b43cbbacca4fad297d6a`.
- Dedicated successor: `tests/browser/tc0305-phase-b-early-send.spec.js`.
- Exact Chromium command:
  `ATOLL_TEST_WEB_PORT=17135 ATOLL_TEST_MOCK_PORT=26135 npx playwright test
  tests/browser/tc0305-phase-b-early-send.spec.js --repeat-each=3
  --workers=1 --reporter=line`; result `3 passed (31.4s)`.
- Public evidence: early click produced the current exact public alert
  `请选择收件人或目标 Agent`, preserved the draft, and emitted zero
  `agent.ask` submits. After the public chooser exposed `steward`, the same
  draft sent once and reached visible `PONG` in all repeats.
- Migration note: the old baseline's longer helper text
  (`请 @ 一个成员，或在右下角选择目标 Agent`) is no longer the current
  user-facing copy. The successor does not use a weaker substring or hidden
  state; it asserts the current `role=alert` exact text while retaining the
  strict zero-submit, draft-retention, one-submit, and terminal gates.
- The deliberate OBS-delay fault emitted an expected `directory.refresh_failed`
  console diagnostic during the delayed-publication window; no test failure or
  page crash occurred and it was not used as acceptance evidence.
- `npm run build`: passed (`vite v8.0.16`, 4306 modules, 2.96s); only the
  existing large-chunk warning was emitted.
- Result: `PASS` / browser migration accepted. No product gap was found.
- Scope audit: only this report and the dedicated browser spec changed; no
  product source, vendor, package/lock, existing test, fixture, skip, or
  weakened behavioral assertion was added.
