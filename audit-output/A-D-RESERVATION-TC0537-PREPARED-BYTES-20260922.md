# A–D reservation — TC-0537 / AD-243 prepared-byte retention

## Reservation

- **Case key:** `TC-0537` (A–D alias `AD-243`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:150`
- **Baseline title:** `bounds prepared AST retention by bytes without discarding durable block identity`
- **Current base:** `f519c7c6b7cbda5bc72779f318f3738e3dc29673`
- **Branch:** `unit-a-d/tc0537-prepared-bytes-f519c7c`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0537-prepared-bytes-f519c7c`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The content-plan store must bound retained prepared render data by bytes without
discarding the durable block identity the user relies on. A committed plan may
release its prepared AST when the configured byte budget is exceeded, while
its block IDs remain stable and the same committed plan is reused on a later
lookup.

The invariant is the public `createContentPlanStore` contract: with
`preparedByteLimit: 1`, the committed plan initially has prepared bytes and
prepared roots, the retained projection drops those heavy roots and reports
zero retained prepared bytes, and a later `plan` for the same key returns the
same plan with the original block ID sequence. The public owner is
`createContentPlanStore` in `src/model/content-plan.js`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0537`
   row for `tests/content-plan.test.js:150`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-243` row.
2. Exact searches for `TC-0537`, `TC0537`, `AD-243`, `AD243`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0533/AD-239 covers count-based plan retention, TC-0535/AD-241 covers
   exact candidate replay, and TC-0536/AD-242 covers abandoned candidates.
   This claim covers only line 150 and does not duplicate them or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a store with
`preparedByteLimit: 1`, commit a plan with prepared roots, assert the source
plan has prepared bytes and roots while the retained projection has released
them, assert the store reports zero prepared bytes, then re-plan the same key
and assert the durable block IDs and object identity are unchanged. Only the
declaration title receives the case tag; no byte-budget, root-release, or
identity assertion is deleted or weakened.

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

- Reservation commit: `a7246af` (`test(a-d): reserve TC-0537 prepared bytes`).
- The existing public declaration is tagged
  `[TC-0537][AD-243]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0537' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.56s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The byte budget released prepared roots and
  retained zero prepared bytes without changing the committed object or its
  block IDs; a later plan lookup reused that durable identity. The public owner
  was sufficient, so no product gap or regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
