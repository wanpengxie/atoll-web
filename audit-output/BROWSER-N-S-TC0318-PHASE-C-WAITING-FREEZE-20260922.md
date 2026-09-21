# BROWSER-N-S TC0318 — Phase-C queued Waiting freeze

## Verdict

**ACCEPT — public browser migration is green (unique credit: TC0318).**

An active Agent turn can be stopped while a later request remains queued in
the public Waiting region.  The queued request stays out of the Timeline,
the stopped Agent turn exposes the canonical frozen state, and Waiting does
not incorrectly inherit a pause/resume state.  This is a public browser
contract; no private store, React fiber, diagnostic endpoint, wire frame, or
selector-only probe is part of the verdict.

## Scope and provenance

- Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda`
  (`tests/browser/phase-c.spec.js:243-256`, C-BR-06/08).
- Exact product base: `2ed64defffb7ed20874fc23d298789a86e70aa2f`.
- Independent worktree:
  `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/.tmp-tc0318-waiting-freeze-2ed64de`.
- Branch: `codex/composer-tc0318-waiting-freeze-2ed64de`.
- Successor: `tests/browser/tc0318-phase-c-waiting-freeze.spec.js`.
- This closeout changes only the successor browser spec and this audit file;
  no product, vendor, package, mock fixture, or skip was changed.

## De-duplication and ownership

The migration ledger row is `TC-0318` (`C-BR-06/08`, baseline line 243).
Exact scans of refs, worktrees, tracked browser tests, and audit output found
no TC0318 successor or active claim before reservation.  TC0315 covers the
terminal Waiting projection after a completed/rejected operation, TC0316
covers editing a queued row while an active turn is interrupted, and TC0317
covers Waiting “插入”; none asserts the queued-row freeze boundary exercised
here.  TC0319 is separately owned by the neighboring migration and is not
duplicated.  No Space or SZ212 contract is included.

## Public contract mapping

The successor keeps the baseline user journey through current public roles
and DOM:

1. reset the `long-running` scenario with seed `107` and log in as `root`;
2. send `阶段C待打断长任务` and wait for its public Timeline turn;
3. send `队列中的后续任务`, require that text in the public `等待区`, and
   require it absent from the Timeline;
4. stop the first turn and require its public `✗ 已停止 · 发消息即继续`
   state;
5. require Waiting not to show `已暂停` and require no public `继续` button.

The observable proves the queued request remains owned by Waiting while only
the active Agent turn is frozen; it does not inspect internal queues or
mutate state outside the public interaction.

## Exact execution

Focused public browser repeat:

```text
ATOLL_TEST_WEB_PORT=15234 ATOLL_TEST_MOCK_PORT=18894 \
  npx playwright test tests/browser/tc0318-phase-c-waiting-freeze.spec.js \
  --repeat-each=3
```

Result: **3 passed (17.2s)**.

Adjacent owner tests:

```text
npm test -- tests/agent-control.test.jsx \
  tests/agent-information-architecture.test.jsx \
  tests/task-controls-restore.test.jsx tests/waiting-layout.test.jsx \
  tests/waiting-currentness-public.test.jsx
```

Result: **5 suites passed; 45 tests passed**.

Build:

```text
npm run build
```

Result: **PASS** (`vite v8.0.16`, 4306 modules transformed; only the existing
large-chunk advisory was emitted).

## Owner and boundary

The public owner exercised by this contract is the Waiting projection and
Timeline row renderer through the current Workspace/ConversationSurface
path.  The test-only migration requires no product change at the exact
base, preserves the single Waiting/Timeline ownership model, and does not
introduce dynamic reserve, a second store, or a Composer workaround.
