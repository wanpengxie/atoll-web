# Browser A–F — TC-0320 / C-BR-08/11 approval schema

Date: 2026-09-22
Exact base snapshot: `a0e9c74d0ecfe9856f4cac5bcc8faf27cc0f7330`

## Atomic claim and dedupe

This packet claims one previously uncredited A–F migration baseline:

- key: **TC-0320**;
- baseline declaration: `fae8b70:tests/browser/phase-c.spec.js:269`;
- user label: **C-BR-08/11 审批按公开闭集提交备注并由终态恢复处理者**;
- migration ledger row: `audit-output/TEST-CASE-MIGRATION-LEDGER.md:671`;
- first public owner boundary: the visible approval card's user decision
  controls and the server-backed terminal projection in the ConversationSurface.

Exact-key/title searches across current browser specs, audit reports,
branches, and worktrees found no earlier TC-0320 claim or successor. Existing
TC-0292 and F4 contracts cover a simple approval or task aggregation, while
AD257 covers rejected control promises; none preserves this old note → approve
→ resolver → structured result → reload contract.

## Preserved public contract

The successor keeps the fae user journey:

1. reset the public `approval-schema` scenario and sign in as `root`;
2. read the visible impact on the pending approval card and enter a note;
3. choose the public `批准` action;
4. require the terminal's visible `处理者：root · approve` and the submitted
   note in the public structured result;
5. reload and require the same settled approval/resolver to remain visible.

Only public controls, visible text, and the user-facing approval projection are
used. The test does not inspect private stores, websocket frames, diagnostic
markers, fixture internals, or product implementation details.

## Owner boundary

The first user-visible owner is the approval card/ConversationSurface terminal
projection, backed by the submission owner. This packet does not alter that
owner, the mock scenario, or any product source.

## Verification

Successor: `tests/browser/tc0320-phase-c-approval-schema.spec.js`.

Planned exact command:

```text
ATOLL_TEST_WEB_PORT=<free> ATOLL_TEST_MOCK_PORT=<free> \
npx playwright test tests/browser/tc0320-phase-c-approval-schema.spec.js \
  --repeat-each=5 --workers=1 --reporter=line
```

## Exact result

Command:

```text
ATOLL_TEST_WEB_PORT=17121 ATOLL_TEST_MOCK_PORT=26121 \
npx playwright test tests/browser/tc0320-phase-c-approval-schema.spec.js \
  --repeat-each=5 --workers=1 --reporter=line
```

Result: **ACCEPT — 5/5**. Every fresh Chromium repeat showed the pending
approval and impact, accepted the user note through the visible `批准` button,
painted the authoritative `处理者：root · approve` terminal, exposed the same
note in the visible structured result, and restored that settled resolver after
reload. No page-error or private-wire condition was used as an acceptance
gate.

`npm run build`: **PASS** (Vite, 4306 modules). No product, vendor, package,
fixture, or existing test file was changed.
