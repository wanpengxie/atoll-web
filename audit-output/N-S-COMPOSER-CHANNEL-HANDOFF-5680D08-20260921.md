# Browser N–S unique case — Composer channel handoff

Date: 2026-09-21
Case ID: `BROWSER-COMPOSER-CHANNEL-HANDOFF-001`
Product commit under review: `5680d0862e6d2654e53a5f70a3efb9c79ebb3136`
Owner: public Workspace channel navigation → Composer/Tiptap EditorView handoff.

## CAS / uniqueness

This claim covers exactly one declaration:
`tests/browser/composer-channel-switch.spec.js:35`,
“channel replacement keeps the Composer mounted through the EditorView
handoff”. Before the claim, no audit/docs row or prior CAS record named this
exact file/title. The adjacent N–S notification/Tiptap packet does not claim
this standalone channel-handoff declaration. The other four declarations in
the same file remain out of scope.

The sole user-credit row is therefore
`BROWSER-COMPOSER-CHANNEL-HANDOFF-001`; no suite-level or adjacent-case credit
is inferred.

## Case contract

| Field | Contract |
|---|---|
| User capability | After switching from `c0` to `c0.project` and back, the user still has a mounted Composer editor and can continue editing. |
| Invariant | The committed channel/Composer handoff does not expose a stale or missing Tiptap `EditorView`; no public page error reports `editor view is not available` or `Cannot read properties of null`. |
| Setup/action | Reset public `multi-channel` seed `0x4e_02`; log in as `root`; click the real public channel buttons in both directions; assert each heading and `.composer-richtext` mount. |
| Public owner/observables | `WorkspaceApp` channel navigation and Composer public DOM; the test also retains the user-visible page-error/console guard for the two known EditorView failures. |
| Disposition | **ACCEPT / PASS**, after a test-only selector correction. |

## First run and fixture/selector ruling

The unchanged declaration first stopped before the Composer assertion at:

```text
getByRole('button', { name: '# c0.project', exact: true })
```

The real public DOM contained the channel button with accessible name
`# c0.project 未读状态待同步`. The channel existed and the workspace remained
healthy; only the exact accessible-name selector was stale because the public
rail appends its visible sync-status text. This is a test selector issue, not
a product or fixture regression. The original context is retained under the
focused run output.

The test now matches only the stable public identity prefix:

```js
await page.getByRole('button', { name: /^# c0\.project(?:\s|$)/ }).click();
```

No product code, mock fixture, assertion semantics, skip, or timeout was
changed.

## Exact verification

```text
ATOLL_TEST_WEB_PORT=25886 ATOLL_TEST_MOCK_PORT=25887 \
npx playwright test tests/browser/composer-channel-switch.spec.js \
  --grep='channel replacement keeps the Composer mounted through the EditorView handoff' \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-ns-composer-channel-handoff-5680d08-repeat3
3 passed (14.3s)
```

All three runs crossed both channel replacements, observed the Composer mount
after each heading, and retained an empty matching page-error/console list.

## Boundary

This commit registers only the claimed browser case and its selector audit. It
does not claim the other four Composer channel-switch declarations, notification
N2, or any product fix. No `src/`, vendor, package, lockfile, fixture, or
existing owner file changed.
