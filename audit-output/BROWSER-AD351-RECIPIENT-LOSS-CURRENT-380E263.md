# Browser AD-351 recipient-loss — exact current verification

Date: 2026-09-21  
Exact product/test SHA: `380e263b5bf50a7e5e1559b4d3534e3e2f40ad4d`  
Reviewer: Browser N-S independent acceptance

## Central CAS decision

AD-351's unit/public-owner capability is already counted and is not claimed
again here:

- `tests/blocked-round16-public-owner.test.jsx:383` is the existing public
  model/delivery oracle.
- `audit-output/A-D-BLOCKED-EVIDENCE-ROUND16-20260920.md:49` records the
  `lost` delivery and hard message-construction rejection.
- `audit-output/RESTORE-CASES-A-D-20260919.md:358` records the migrated
  source case and the same owner.

No prior central audit row was found for the real-browser
`tests/browser/composer-recipient-loss.spec.js` contract. This report claims
only that distinct browser contract (DOM plus public websocket observation),
not a second AD-351 product capability.

## Exact browser run

Fresh detached worktree at the exact SHA; `node_modules` was symlinked from
the shared dependency installation. Command:

```sh
ATOLL_TEST_WEB_PORT=25730 ATOLL_TEST_MOCK_PORT=25731 \
npx playwright test tests/browser/composer-recipient-loss.spec.js \
  --repeat-each=5 --workers=1 --reporter=list
```

Result: **5 passed (31.3s)**.

## User-visible oracle

The mock `message-flow` scenario is reset with seed `3511`. The test then:

1. selects `@Claude` and keeps a draft;
2. removes Claude through the public channel-governance UI;
3. verifies the `@Claude` chip remains visible;
4. verifies the public alert says Claude is no longer in the channel and
   delivery is unavailable;
5. clicks Send and verifies the draft remains and no `agent.ask` submit frame
   is sent.

This is a Composer lost-recipient guard. It does not assert a backend
preflight or a zero-wire rule for a server-retired channel.

## Credit/provenance

Browser evidence is unique at the central CAS level because the existing
AD-351 entries cover the unit/public model owner only. Product files and the
formal browser spec were not changed for this verification; this audit file
is the only proposed test-side change.
