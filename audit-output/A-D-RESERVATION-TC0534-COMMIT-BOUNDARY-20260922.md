# A–D reservation — TC-0534 / AD-240 commit boundary

## Reservation

- **Case key:** `TC-0534` (A–D alias `AD-240`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:120`
- **Baseline title:** `does not publish a prepared render candidate before its commit boundary`
- **Current base:** `c16ffb137e501686a3dbb0055bd29fc8a4e39418`
- **Branch:** `unit-a-d/tc0534-commit-boundary-c16ffb1`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0534-commit-boundary-c16ffb1`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

Preparing a content render candidate must not make it visible as committed
content before the publication boundary. Once the user-visible commit occurs,
the exact prepared plan becomes retrievable under its content key.

The invariant is the public `createContentPlanStore` contract: a prepared
`candidate` plan is absent from `store.get('candidate')` before `commit`; after
`store.commit(prepared)`, retrieval returns that same plan object. This keeps
unpublished work from leaking into the committed view while making the commit
atomic for the user. The public owner is `createContentPlanStore` in
`src/model/content-plan.js`; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0534`
   row for `tests/content-plan.test.js:120`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-240` row.
2. Exact searches for `TC-0534`, `TC0534`, `AD-240`, `AD240`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0533/AD-239 covers bounded retention, while TC-0535/AD-241 covers
   exact unpublished candidate replay. This claim covers only line 120 and
   does not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a bounded store and a
`candidate` plan, assert `store.get('candidate')` is null before commit, commit
the plan, and assert retrieval returns the exact prepared object. Only the
declaration title receives the case tag; no publication-boundary assertion is
deleted or weakened.

If the current public composition cannot express this contract without a
private implementation detail, record that first boundary as a bounded
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan.test.js` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- Reservation commit: `65ef81e` (`test(a-d): reserve TC-0534 commit boundary`).
- The existing public declaration is tagged
  `[TC-0534][AD-240]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0534' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.94s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The prepared candidate remained absent before
  commit and became retrievable as the exact same plan after commit. The
  public owner was sufficient, so no product gap or regression packet was
  found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
