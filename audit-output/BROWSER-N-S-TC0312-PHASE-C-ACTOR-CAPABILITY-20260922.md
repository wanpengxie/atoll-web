# Browser N–S TC0312 migration — Phase C actor capability payload

Date: 2026-09-22  
Baseline: `fae8b70:tests/browser/phase-c.spec.js:117`  
Current base: `ce6acb8b649c0418923f5cee6ac288aeb3cf86f9`

## Claim and uniqueness

TC0312 is the next unclaimed Workspace browser row after TC0311 in the
central migration ledger. The six basename N–S specs are already accounted for
in `BROWSER-N-S-FAE8B70-MIGRATION.md`; this is not a duplicate of those 15
rows. Before adding this successor, the worktree and current tree were checked
for `TC0312`, `C-BR-02/03/04`, `mock.order.create`, and a phase-C successor.
No existing successor spec, audit claim, branch, or worktree was found.

## Current public contract

The old phase-C page exposed one control per schema field. The current product
owner is `RosterFeature.ActorDetailPanel`, which publicly exposes the declared
`mock.order.create` capability through a `参数 JSON` text box and an explicit
`刷新能力` action. The migration keeps the user-observable obligations:

1. the actor's declared capability is visible;
2. a valid typed payload remains unchanged while the public capability
   observation is refreshed;
3. the submitted wire payload preserves string, integer, enum, and boolean
   values without a test-only/private shortcut; and
4. the resulting business object is readable in the public structured-result
   presentation.

This is a test-only successor. No product, vendor, package, lockfile, mock,
or assertion weakening change is included.

## Evidence

Successor: `tests/browser/tc0312-phase-c-actor-capability-schema.spec.js`.

Focused command (fresh mock and Vite servers):

```text
ATOLL_TEST_WEB_PORT=15193 ATOLL_TEST_MOCK_PORT=18852 \
  npx playwright test \
  tests/browser/tc0312-phase-c-actor-capability-schema.spec.js \
  --repeat-each=3 --reporter=line \
  --output=test-results-tc0312-repeat3-ce6acb8
```

Result: **PASS 3/3** on the exact current-base worktree. The run used fresh
mock and Vite servers for each Playwright invocation:

```text
ATOLL_TEST_WEB_PORT=15194 ATOLL_TEST_MOCK_PORT=18853 \
  npx playwright test \
  tests/browser/tc0312-phase-c-actor-capability-schema.spec.js \
  --repeat-each=3 --reporter=line \
  --output=test-results-tc0312-repeat3-ce6acb8-r2
```

All three runs observed the current public Actor detail, preserved the JSON
payload after `刷新能力`, captured the exact public submit payload, and read
the returned structured order in the timeline. No public DOM or wire boundary
diverged, and no page error was observed. `npm run build` is required before
commit.

## Owner boundary

If the public test is red, the first boundary is the Workspace owner chain
(`WorkspaceApp` → `RosterFeature.ActorDetailPanel` → submission/structured
result projection). Diagnostics or internal stores are not verdicts.
