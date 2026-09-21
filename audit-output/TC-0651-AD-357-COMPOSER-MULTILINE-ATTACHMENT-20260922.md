# TC-0651 / AD-357 — Composer multiline, attachment entry, accepted send

## Claim and uniqueness

This is the single current-owner claim for numeric case **TC-0651** and alias
**AD-357**. The migration ledger maps TC-0651 to
`fae8b70:tests/dynamic-f3.test.jsx:617`; the A-D migration table maps the same
behavior to AD-357. No other current audit report claims this pair. The
existing `src/model/composer-model.test.js:240` assertion with the TC-0651
label covers only pure-attachment message payload construction; it does not
claim the historical public UI sequence below and remains partial evidence for
this row, not a second case.

The adjacent rows were excluded: TC-0650/AD-356 is the mention-then-command
review already in progress; TC-0652/AD-358 is preview/remove; TC-0653/AD-359
and TC-0654/AD-360 are paste/drop; and TC-0655/AD-361 is the IME lifecycle
contract. Those rows have separate current-owner evidence or active claims.

## Historical user contract

The exact old baseline (`fae8b70:tests/dynamic-f3.test.jsx:617-637`) used the
public Composer to:

1. render the message textbox;
2. upload one local file through `上传本机文件到频道` and observe one upload;
3. open `从频道文件选择` and observe one picker action;
4. enter two lines with Shift+Enter, without sending on the line break;
5. press Enter once and observe one accepted send.

## Root cause and minimal fix

The current Composer owns the mounted Tiptap EditorView and built the live
text snapshot with `editor.getText({ blockSeparator: '\\n' })`; the explicit
Enter path separately used `doc.textBetween(..., '\\n')`. Tiptap represents
Shift+Enter as a `hardBreak` leaf, not as a block boundary. Both paths therefore
returned `第一行第二行` even though the mounted document visibly contained a
`hardBreak`, losing the user's line break at draft persistence/send time.

`Composer.jsx` now has one local `textFromDocument` projection that passes
`leafText='\\n'` to ProseMirror `textBetween`. Both `editorText()` (onUpdate,
idle draft persistence, picker snapshot, and live snapshot) and the synchronous
pre-send snapshot use it. The canonical Tiptap document is unchanged; no new
state, store, port, authority check, or compatibility path was added.

## Current public evidence

- `tests/f6-composer-isolation.test.jsx` exercises the public `Composer
  model+commands` boundary: local file upload, channel picker entry, Shift+Enter
  multiline editing, no send on the line break, one accepted send, exact
  `draft.text === '第一行\\n第二行'`, and editor clear after the accepted result.
- `tests/browser/composer-channel-file-picker-contract.spec.js` repeats the
  same public App path with a real local file, picker cancellation preserving
  draft/attachment, and a materialized turn containing both lines.
- The browser test was run with `--repeat-each=3`; all three passed. The full
  picker contract (six existing cases plus this case) and TC-0162 attachment
  source contract passed: **7/7**.

## Verification

From branch `codex/composer-tc0651-ad357-d754f0d`, based on exact current
`e60b20a9043594aaaa7064cac93782acae3cadf4` (the candidate was rebased after
two unrelated mainline commits landed):

```text
npx vitest run tests/f6-composer-isolation.test.jsx src/model/composer-model.test.js tests/composer-editor-lifecycle.test.jsx tests/app-shell-composer-port.test.jsx --reporter=dot
4 files, 34 tests passed

npx vitest run tests/f6-composer-isolation.test.jsx -t 'TC-0651 / AD-357' --reporter=dot  (3 parallel repeats)
3/3 passed

npx playwright test tests/browser/composer-channel-file-picker-contract.spec.js \
  --grep 'TC-0651 / AD-357' --repeat-each=3 --reporter=line
3/3 passed

npx playwright test tests/browser/composer-channel-file-picker-contract.spec.js \
  tests/browser/tc0162-composer-source-distinction.spec.js --reporter=line
7/7 passed

npm run build
passed (Vite production build)
```

Only the Composer owner, its direct public tests, and this audit report are in
the candidate diff. Workspace, Feed, Roster, vendor, package, backend, and
protocol files are untouched.
