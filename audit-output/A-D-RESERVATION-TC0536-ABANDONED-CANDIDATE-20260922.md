# A–D reservation — TC-0536 / AD-242 abandoned candidate isolation

## Reservation

- **Case key:** `TC-0536` (A–D alias `AD-242`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:141`
- **Baseline title:** `never treats a different abandoned candidate as committed previous identity`
- **Current base:** `f519c7c6b7cbda5bc72779f318f3738e3dc29673`
- **Branch:** `unit-a-d/tc0536-abandoned-candidate-f519c7c`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0536-abandoned-candidate-f519c7c`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

If one prepared render candidate is abandoned and a different candidate for the
same key is prepared, the replacement must not inherit the abandoned
candidate's revision or appear as committed content. The user-visible commit
must remain explicit, so stale or abandoned work cannot silently become the
current plan.

The invariant is the public `createContentPlanStore` contract: preparing
`abandoned` and then `replacement` for `concurrent-candidate` gives each a
fresh revision of one, and `store.get` remains null because neither candidate
was committed. The public owner is `createContentPlanStore` in
`src/model/content-plan.js`; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0536`
   row for `tests/content-plan.test.js:141`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-242` row.
2. Exact searches for `TC-0536`, `TC0536`, `AD-242`, `AD242`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0534/AD-240 covers the explicit commit boundary and TC-0535/AD-241
   covers exact candidate replay. This claim covers only line 141 and does not
   duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a bounded store, prepare
two different sources under the same key, assert each candidate has revision
one, and assert the store has no committed value for that key. Only the
declaration title receives the case tag; no abandonment, revision, or
publication assertion is deleted or weakened.

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

- Reservation commit: `d3c68a9` (`test(a-d): reserve TC-0536 abandoned candidate isolation`).
- The existing public declaration is tagged
  `[TC-0536][AD-242]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0536' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.73s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Different uncommitted candidates each started
  at revision one, and neither appeared in committed lookup. The public owner
  was sufficient, so no product gap or regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
