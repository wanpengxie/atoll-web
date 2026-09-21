# A–D reservation — TC-0513 / AD-219 code-block line presentation

## Reservation

- **Case key:** `TC-0513` (A–D alias `AD-219`)
- **Baseline:** `fae8b70:tests/code-block.test.jsx:35`
- **Baseline title:** `五行起显示行号；没写语言按纯文本，标签写 text`
- **Current base:** `65452ed6fdea7af948c9fa40698980f844ea8736`
- **Branch:** `unit-a-d/tc0513-code-lines-65452ed`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0513-code-lines-65452ed`
- **Allowed change:** this report and the existing declaration in `tests/code-block.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user can read a long fenced code block with stable visual line numbers, while
an unlabeled fence is presented as plain text (`text`) rather than a guessed
language. The rendered five source lines remain one-for-one with the five visible
line-number elements.

The invariant is a pure `MarkdownContent` → `CodeBlock` projection: line numbers
are derived from the rendered code body and do not alter the source text, syntax
mode, or inline-code path. Short/inline code must not be accidentally promoted
to a fenced numbered block. The current public owner is the existing
`MarkdownContent`/`CodeBlock` composition in `src/ui/MarkdownContent.jsx` and
`src/ui/CodeBlock.jsx`; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0513`
   row for `tests/code-block.test.jsx:35`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0513`, `TC0513`, `AD-219`, `AD219`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. The preceding TC-0511/AD-217 language mapping and TC-0512/AD-218 rendering
   claims cover separate declarations. This claim does not duplicate either
   case or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render an unlabeled five-line
fence, assert the numbered-block class and five line-number elements, and assert
the displayed language is `text`. If the current public composition cannot
express the contract without a private implementation detail, record that first
boundary as a product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the declaration.
Closeout will append exact focused/full test and build evidence, the
capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/code-block.test.jsx` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- The existing public declaration is tagged `[TC-0513][AD-219]` without changing
  its setup or assertions. It continues to exercise the public
  `MarkdownContent` → `CodeBlock` composition.
- Focused case:
  `npm test -- tests/code-block.test.jsx --run -t 'TC-0513' --reporter=verbose`
  — **1 passed, 3 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent code-block suite:
  `npm test -- tests/code-block.test.jsx --run --reporter=verbose`
  — **4 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.16s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. The unlabeled five-line fence remained plain text,
  rendered as a numbered block with exactly five line-number elements, and the
  inline-code path stayed unaffected. No product gap or unrelated rendering
  change was found.
- Committed files are limited to this report and
  `tests/code-block.test.jsx`; `node_modules` remains an untracked symlink.
