# TC-0319 browser successor — actor lifecycle capability boundary

- Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`tests/browser/phase-c.spec.js:258-267`)
- Successor base: `5288a26068b1f4053b0a40e9750aca6678130457`
- Successor: `tests/browser/tc0319-phase-c-actor-lifecycle-capabilities.spec.js`
- Scope: T–Z browser migration only; no product, vendor, fixture, package, skip, or threshold change.

## Contract mapping

The historical `actor-lifecycle` scenario and Steward Actor-details flow are retained. The browser asserts the user-visible capability boundary: Actor details do not advertise `agent.restart` or `agent.terminate`, while the declared `agent.interrupt` capability remains present exactly once. This preserves the old contract that lifecycle operations must not be invented from an actor's identity or metadata.

The successor uses the current public roster button, Actor-details complementary panel, and `.capability-row` projection. It does not inspect private state, wire diagnostics, or implementation capability maps.

## Uniqueness / ownership

The migration ledger row is `TC-0319` (`C-BR-07/09/10`, source `tests/browser/phase-c.spec.js:258`). At claim time, `git log --all`, `git branch -a`, `git worktree list`, tracked `tests/browser`, and tracked T–Z audit files contained no TC-0319 successor or active claim. TC-0311 metadata and TC-0312 schema migrations were excluded as adjacent but non-equivalent contracts. This commit owns only TC-0319.

## Evidence

- Chromium: `ATOLL_TEST_WEB_PORT=25173 ATOLL_TEST_MOCK_PORT=25183 npx playwright test tests/browser/tc0319-phase-c-actor-lifecycle-capabilities.spec.js --repeat-each=3` — **3 passed**.
- Adjacent Actor Describe contract: `ATOLL_TEST_WEB_PORT=25174 ATOLL_TEST_MOCK_PORT=25184 npx playwright test tests/browser/tc0311-actor-describe-metadata.spec.js --repeat-each=1` — **1 passed**.
- Build: `npm run build` — **passed**.

No product gap or environment failure was observed.
