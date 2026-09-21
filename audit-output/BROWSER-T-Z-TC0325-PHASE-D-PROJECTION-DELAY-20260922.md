# Browser T–Z TC-0325 / D-BR-03

## Claim and baseline

- Unique ledger row: `TC-0325`, `audit-output/TEST-CASE-MIGRATION-LEDGER.md:676`.
- Historical source: `fae8b70:tests/browser/phase-d.spec.js:99`.
- Exact verification base: `144b9025934e899401ad92313587c404357a6407`.
- Repository search found no competing TC0325 successor spec, branch, or audit.
- TC0324 is a separate D-BR-01/02/04 declaration and is not reused as credit.

## Preserved user contract

The old D-BR-03 journey starts the public c0 child-channel create task under the
`channel-governance-delay` scenario, observes `账本确认` become `已确认`, and
then waits for the delayed directory projection to settle to the user-facing
ready copy. The successor keeps those same setup, action, and result facts on
the current public `ChannelCreateModal` owner. It additionally asserts that
the ready projection never presents `创建失败`; it does not inspect private
wire state, timers, diagnostics, or a second store.

## Verification

Dedicated Chromium run in a clean detached worktree
`/tmp/atoll-web-tc0325-current-144b902`:

```text
ATOLL_TEST_WEB_PORT=17233 ATOLL_TEST_MOCK_PORT=18933 \
  npx playwright test tests/browser/tc0325-phase-d-projection-delay.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed** (21.7s). Each repetition reached the ledger-confirmed
state and the final `频道已经可以打开和协作。` result within 15 seconds.

Adjacent public creation regression:

```text
ATOLL_TEST_WEB_PORT=17234 ATOLL_TEST_MOCK_PORT=18934 \
  npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js \
  -g 'TC-0192' --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed**. The mock emitted its existing reconnect/resource
diagnostic (`bad_payload: channel does not exist`) during the adjacent run;
it did not fail the public assertions or produce a page error.

`npm run build`: **PASS** (`4306 modules transformed`; existing large-chunk
warning only).

## Result

**ACCEPT / credit 1.** This is a test/audit-only migration. No product, mock,
fixture, vendor, package, snapshot, skip, or threshold was changed.
