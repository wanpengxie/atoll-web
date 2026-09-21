# Browser T–Z — TC-0264 / LAYOUT-03

## Atomic claim and CAS precheck

This packet claims exactly one previously uncredited baseline declaration:

- baseline: `fae8b70:tests/browser/layout-responsive.spec.js:94`
- numeric key: **TC-0264**
- user label: **LAYOUT-03 @成员菜单以输入区为边界且不改变输入区位置**
- current base: `d754f0d4e8b13ec316630732a86adb18a4b967d5`

Before adding the successor, the unique ledger contained the one TC-0264 row
(`audit-output/TEST-CASE-MIGRATION-LEDGER.md:615`) with the target path absent
and runtime unproven. A tracked-HEAD search found no existing `TC-0264`,
`LAYOUT-03`, or equivalent dedicated public-owner claim in the T–Z audit/test
surface. Existing responsive and Composer tests cover adjacent controls but do
not claim this baseline's member-menu geometry and stable input position.

The claim is therefore a new test-and-audit delivery, not an audit-only
duplicate.

## Preserved public contract

The fae8b70 test sets a 320×720 viewport, opens the Composer member menu by
typing `@`, and requires all of the following observable results:

1. the menu is visible;
2. the input's vertical position is unchanged;
3. the menu stays within the Composer input-area horizontal bounds; and
4. the menu stays inside the viewport vertically.

The successor at
`tests/browser/tz-tc0264-composer-menu.spec.js` uses only public roles and the
current Composer DOM anchor. The current implementation mounts the listbox in
the document-level `FloatingPortal`, so the old `closest('.composer-input-area')`
relationship is not a valid current selector. The test compares the portal's
public listbox rectangle with the existing `.composer-input-area` anchor while
retaining the same geometry gates; no threshold or capability was relaxed.

## Exact Chromium evidence

Command:

```text
ATOLL_TEST_WEB_PORT=16365 ATOLL_TEST_MOCK_PORT=19365 \
npx playwright test tests/browser/tz-tc0264-composer-menu.spec.js \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-tz-tc0264-repeat3-r2
```

Result on exact `d754f0d4e8b1`:

```text
3 passed (16.5s)
```

The first disposable run using the old parent relationship failed with
`areaLeft=NaN`; that is the expected migration selector mismatch caused by the
current portal mount, not a product failure. The corrected public-anchor
successor passes all three repetitions.

## Scope and ownership

The current owner is the public Composer/mention-menu surface in
`src/ui/composer/Composer.jsx`; the test adds no private export, store,
compatibility path, product source, package change, skip, or weakened
assertion. This delivery consists only of the successor spec and this audit.
