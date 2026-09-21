# A–D reservation — TC-0523 / AD-229 ordinal collision

## Reservation

- **Case key:** `TC-0523` (A–D alias `AD-229`)
- **Baseline:** `fae8b70:tests/content-plan-blocks.test.jsx:146`
- **Baseline title:** `rejects an ordinal id reused for different text after plan history is unavailable`
- **Current base:** `640d4459317e472ad3d9912ac36f21c95208d481`
- **Branch:** `unit-a-d/tc0523-ordinal-collision-640d445`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0523-ordinal-collision-640d445`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-blocks.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

After content-plan history is unavailable and a new prefix shifts block
ordinals, a user’s saved point must follow its unique surviving text block,
not the block that happens to reuse the old ordinal ID. The target passage must
remain selectable/resolvable at its updated offset and the resolver must not
silently return the newly inserted `first` block.

The invariant is a pure content-plan projection: `resolveContentTextPoint`
uses stable identity plus a unique content fingerprint/context to disambiguate
ordinal reuse. The public owner is the `ContentPlanBlocks`/content-plan
composition in `src/ui/ContentPlanBlocks.jsx` and `src/model/content-plan.js`;
no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0523`
   row for `tests/content-plan-blocks.test.jsx:146`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0523`, `TC0523`, `AD-229`, `AD229`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0517/AD-223 through TC-0522/AD-228 cover separate declarations in this
   file. This claim does not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render
`first\n\ntarget passage` under `message:evicted:body`, describe a point in
`target passage`, unmount, rebuild the same content key with
`inserted\n\nfirst\n\ntarget passage` and no previous plan, then render through
`ContentPlanBlocks`. Assert the reused ordinal node is the `first` block but
the resolved point uses the `target passage` block, `unique-fingerprint`
matching, and offset `7`. Only the declaration title receives the case tag;
no ordinal or fingerprint assertion is weakened.

If the current public composition cannot express this contract without a
private implementation detail, record that first boundary as a bounded
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan-blocks.test.jsx`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and other tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

## Closeout evidence

- Reservation commit: `f907fd3` (`test(a-d): reserve TC-0523 ordinal collision`).
- The existing public declaration is tagged
  `[TC-0523][AD-229]` without changing its setup, action, or assertions. It
  continues to exercise the public text-point resolution boundary.
- Focused case:
  `npm test -- tests/content-plan-blocks.test.jsx --run -t 'TC-0523' --reporter=verbose`
  — **1 passed, 6 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan block suite:
  `npm test -- tests/content-plan-blocks.test.jsx --run --reporter=verbose`
  — **7 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 4.39s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The old ordinal collision pointed at `first`,
  while the resolver selected `target passage` by its unique fingerprint and
  returned offset `7`. No product gap or unrelated rendering change was
  found.
- Closeout changes remain limited to this report and
  `tests/content-plan-blocks.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
