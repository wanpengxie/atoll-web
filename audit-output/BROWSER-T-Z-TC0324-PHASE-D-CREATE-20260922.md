# Browser T–Z TC-0324 / D-BR-01/02/04

## Claim and baseline

- Unique ledger row: `TC-0324`, `audit-output/TEST-CASE-MIGRATION-LEDGER.md:675`.
- Historical source: `fae8b70:tests/browser/phase-d.spec.js:72`.
- Exact verification base: `f260ee34d523638d6b195814c71dc81e21eb6d32`.
- No competing `TC0324` spec, branch, or audit was found in the current worktree; `TC0323` is already integrated separately.
- This worktree changes only the successor spec and this audit. No product, mock, fixture, package, vendor, snapshot, or threshold files were changed.

## Owner alignment

The old Channel Context flow used retired `频道模板 ID`, `读取完整详情到账本`, and a private operation-reveal helper. The current public owner is:

1. `ChannelCreateModal` — typed create request and four-step convergence (`账本确认`, `频道可观察`, `成员关系`, `服务就绪`).
2. Shell channel rail — canonical `c0.design-room` directory projection.
3. Activity Center operation source — the create receipt returns to the originating c0 turn and exposes `创建子频道：design-room`.
4. `ChannelAdministrationPanel` overview — canonical c0 facts and child row (`design-room`, `服务中`).

The migration retains the old user-visible name, purpose, successful convergence, child visibility, operation return, and detail result. It replaces only retired selectors/internal surfaces with these public equivalents; it does not assert private wire or store state.

## Verification

### Dedicated TC-0324

```text
ATOLL_TEST_WEB_PORT=17228 ATOLL_TEST_MOCK_PORT=18928 \
  npx playwright test tests/browser/tc0324-phase-d-create-convergence.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed**. The test observes all four convergence steps and `已确认` count 4, ready copy, rail child, Activity operation return, and canonical Governance child detail.

### Adjacent regressions

```text
ATOLL_TEST_WEB_PORT=17229 ATOLL_TEST_MOCK_PORT=18929 \
  npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js \
  -g 'TC-0192' --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed**.

```text
ATOLL_TEST_WEB_PORT=17230 ATOLL_TEST_MOCK_PORT=18930 \
  npx playwright test tests/browser/governance-template-wire-contract.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **6 passed** (Registrar list/get ordering and modal recipe path). The adjacent runs emitted the pre-existing wire reconnect/resource diagnostics but no test failure or page error.

### Build

`npm run build`: **PASS**. Vite emitted only the existing large-chunk warning.

## Result

**ACCEPT / credit 1** for TC-0324. The current product exposes an equivalent public user journey; no product gap was found.
