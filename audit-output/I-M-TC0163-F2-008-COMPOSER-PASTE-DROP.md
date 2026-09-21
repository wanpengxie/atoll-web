# I–M / TC-0163 (F2-008) exact-path migration

## Case and ownership

- **Exact base:** `d50a11ed25b5dedebbfd51aab9d71c45605efbcb`
  (`d50a11e`), with no product or compatibility changes in this worktree.
- **Historical case:** `fae8b70:tests/browser/f2-artifacts.spec.js:167`,
  `Composer 支持粘贴与鼠标拖入本机文件`.
- **User capability:** a user can paste a local file into the current Composer
  or drag a local file over it, see the drop affordance while dragging, and
  have each released file become one attachment in the current draft.
- **Invariant:** both routes are owned by the existing public Composer command
  port and `useAttachmentTransactions`; the event does not open Files, create
  a second attachment store, or add an unbounded/compatibility path. A single
  paste/drop event adds one observable draft row and the transient drop hint is
  gone after release.
- **Current public owner:** `Composer.jsx`'s public input/paste/drop handlers
  call its `upload` command; `WorkspaceApp` wires that command to the existing
  attachment transaction owner. The test observes only the public textbox,
  drop surface, status text, and draft attachment region.

## Baseline mapping and deduplication

TC-0162 is already represented by the current public channel-file picker
browser contract, and TC-0164 is represented by the current Files/file-browser
node-type navigation contract. TC-0160 remains a separate rejected product
package: its geometry, privacy, and preview obligations are not inferred from
this case. TC-0163 is the next distinct F2 user path and is not covered by
those contracts.

The successor preserves the old case's two user actions and observable result
as one exact-path test. It does not call a private helper, inspect an internal
store, or assert upload implementation call counts.

## Evidence

Test: `tests/browser/tc0163-composer-paste-drop.spec.js:19`.

- `ATOLL_TEST_WEB_PORT=15187 ATOLL_TEST_MOCK_PORT=18887 npx playwright test tests/browser/tc0163-composer-paste-drop.spec.js --repeat-each=3`
  → **3 passed**.
- `npx vitest run tests/f6-composer-isolation.test.jsx tests/app-shell-composer-port.test.jsx tests/composer-command-port.test.js tests/outbox-attachment-transaction.test.js --retry=1`
  → **4 files, 38 tests passed**.
- `npm run build` → **passed** (Vite production build; existing chunk-size
  warnings only).

No product source, vendor/package/lockfile, notification/arrival owner,
second route/store, compatibility path, skip, or weakened assertion changed.
