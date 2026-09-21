# A–D reservation — TC-0538 / AD-244 prepared-byte deletion accounting

## Reservation

- **Case key:** `TC-0538` (A–D alias `AD-244`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:165`
- **Baseline title:** `accounts prepared bytes when a retained plan is deleted`
- **Current base:** `8c2939e350bc554d02f606cb4df9347ec3b89d76`
- **Branch:** `unit-a-d/tc0538-delete-bytes-8c2939e`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0538-delete-bytes-8c2939e`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a retained content plan is explicitly deleted, the store must release its
prepared render data and update the byte accounting immediately. The user must
not leave behind invisible retained render memory after the corresponding
content entry has been removed.

The invariant is the public `createContentPlanStore` contract: planning
`delete-prepared` with a prepared-byte budget makes `store.preparedBytes`
positive; deleting that key makes `store.preparedBytes` exactly zero. The
public owner is `createContentPlanStore` in `src/model/content-plan.js`; no
private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0538`
   row for `tests/content-plan.test.js:165`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-244` row.
2. Exact searches for `TC-0538`, `TC0538`, `AD-244`, `AD244`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0537/AD-243 covers byte-budget release at commit while preserving block
   identity. This claim covers only line 165 and does not duplicate it or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a store with a prepared
byte budget, plan `delete-prepared`, assert prepared bytes are positive, delete
the key, and assert the accounting returns to zero. Only the declaration title
receives the case tag; no deletion or byte-accounting assertion is deleted or
weakened.

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

- Reservation commit: `8899ebe` (`test(a-d): reserve TC-0538 prepared byte deletion`).
- The existing public declaration is tagged
  `[TC-0538][AD-244]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0538' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.84s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Deleting the retained plan returned prepared-byte
  accounting from positive to zero. The public owner was sufficient, so no
  product gap or regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
