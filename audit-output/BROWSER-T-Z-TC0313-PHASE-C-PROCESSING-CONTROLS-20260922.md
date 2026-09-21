# TC-0313 browser successor — processing controls

- Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`tests/browser/phase-c.spec.js:145-157`)
- Successor base: `be18ef084676c91c58780b5d65a45190efb618b1`
- Successor: `tests/browser/tc0313-phase-c-processing-controls.spec.js`
- Scope: T–Z browser migration only; no product, vendor, fixture, package, skip, or threshold change.

## Contract mapping

The historical scenario and user-visible actions are retained: reset `long-running` with seed `103`, log in, open the Steward actor context, close it, send `阶段C取消长任务`, and inspect the processing turn. While processing, the public task rail exposes `编辑` and `停止`, does not expose `取消任务`; after `停止`, the same turn shows `✗ 已停止 · 发消息即继续` and its task rail is removed.

The current successor renders the task rail as the public `.task-controls` element without the old ARIA `region[aria-label="任务控制"]` wrapper. The migration therefore scopes the same button assertions to that public DOM rail; it does not weaken the action or terminal assertions.

## Uniqueness / ownership

The migration ledger row is `TC-0313` (`C-BR-03/05`, source `tests/browser/phase-c.spec.js:145`). At claim time, `git log --all`, `git branch -a`, `git worktree list`, tracked `tests/browser`, and tracked T–Z audit files contained no TC-0313 successor or active claim. TC-0300–0309, TC-0310–0312, and TC-0320–0327 were excluded because they already had successors or active branches. This commit owns only TC-0313.

## Evidence

- Chromium: `ATOLL_TEST_WEB_PORT=25075 ATOLL_TEST_MOCK_PORT=25085 npx playwright test tests/browser/tc0313-phase-c-processing-controls.spec.js --repeat-each=3` — **3 passed**.
- Adjacent public processing-edit contract: `ATOLL_TEST_WEB_PORT=25074 ATOLL_TEST_MOCK_PORT=25084 npx playwright test tests/browser/ad027-processing-edit.spec.js --repeat-each=1` — **1 passed**.
- Build: `npm run build` — **passed**.

No product gap or environment failure was observed after isolating the browser ports. The first probe exposed only a migration-selector mismatch (the old ARIA region is not present in the current public successor); the final spec uses the existing public task-control rail and retains all historical behavior gates.
