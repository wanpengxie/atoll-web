# Browser G–M case 6 / TC-0250 CAS

Date: 2026-09-21
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)
Current base: `380e263b5bf50a7e5e1559b4d3534e3e2f40ad4d`
Scope: one browser contract only — `history-start-boundary.spec.js:62` / TC-0250.

## CAS against the unique 1,487-case ledger

The read-only `audit-output/TEST-CASE-MIGRATION-LEDGER.md` records TC-0250 as:

```text
fae8b70:tests/browser/history-start-boundary.spec.js:62
target a8c9165: path absent; blocked pending product decision
```

That ledger therefore has no credit for this declaration. The current G–M
migration has a real successor at
`tests/browser/history-start-boundary.spec.js`; this report closes only the
TC-0250 successor mapping. TC-0251 (the second test in the same file) is not
claimed by this report.

## User-visible contract

On the real `/` AppShell, after login and a normal history-boundary flow:

1. The exhausted history-start marker is one ordinary flow item before the
   oldest visible message. It is visible in the active list and is not
   `absolute`, `fixed`, or `sticky`.
2. A forward wheel scroll moves that single marker out of the viewport, and a
   reverse wheel scroll brings the same marker back. The marker count remains
   exactly one.
3. The browser run records no ResizeObserver-loop diagnostic. This is a
   secondary safety witness; the completion gates are the public marker
   visibility, geometry, identity/count, and real wheel behavior above.

The successor uses the production page and public DOM only for the user gates;
the mock reset is only scenario setup. No private product export, alternate
list owner, source change, vendor change, package/lockfile change, fixture
rewrite, skip, or weakened assertion is involved.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: .worktrees/gm-case6-380e263
base:     380e263b5bf50a7e5e1559b4d3534e3e2f40ad4d
ports:    ATOLL_TEST_MOCK_PORT=26061 ATOLL_TEST_WEB_PORT=17061
```

Command:

```text
ATOLL_TEST_MOCK_PORT=26061 ATOLL_TEST_WEB_PORT=17061 \
npx playwright test tests/browser/history-start-boundary.spec.js \
  --grep='authoritative history start is an ordinary scrolling item' \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/gm-case6-380e263-r3
```

Result:

```text
3 passed (17.8s)
```

The commit containing this audit is audit-only and claims exactly one
previously uncredited 1,487-ledger declaration.
