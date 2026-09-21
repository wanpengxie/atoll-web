# A–D reservation — TC-0514 / AD-220 inline-code boundary

## Reservation

- **Case key:** `TC-0514` (A–D alias `AD-220`)
- **Baseline:** `fae8b70:tests/code-block.test.jsx:44`
- **Baseline title:** `行内 code 不受影响`
- **Current base:** `0463c2f761c0a5785014a6ee0db700e6661405fc`
- **Branch:** `unit-a-d/tc0514-inline-code-0463c2f`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0514-inline-code-0463c2f`
- **Allowed change:** this report and the existing declaration in `tests/code-block.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user can write a short inline code span inside prose and see it remain an
inline `<code>` element with its exact text. It must not be promoted to a fenced
code-block figure, numbered layout, language bar, or copy affordance merely
because the same renderer also supports fenced blocks.

The invariant is a pure `MarkdownContent` boundary: inline code remains inline
while fenced syntax alone selects `CodeBlock`; the projection preserves text and
does not mutate shared rendering state. The current public owner is the
`MarkdownContent`/Markdown renderer composition in
`src/ui/MarkdownContent.jsx`, with `CodeBlock` reserved for fenced nodes. No
private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0514`
   row for `tests/code-block.test.jsx:44`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0514`, `TC0514`, `AD-220`, `AD220`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. TC-0511/AD-217, TC-0512/AD-218, and TC-0513/AD-219 cover separate
   declarations in the same file. This claim does not duplicate them or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render `一句 \`inline\` 话`,
assert that no `figure.code-block` is created, and assert that the inline
`code` element contains exactly `inline`. If the current public composition
cannot express this boundary without a private implementation detail, record
that first boundary as a product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the declaration.
Closeout will append exact focused/full test and build evidence, the
capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/code-block.test.jsx` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- The existing public declaration is tagged `[TC-0514][AD-220]` without changing
  its setup or assertions. It continues to exercise the public
  `MarkdownContent` inline-code boundary.
- Focused case:
  `npm test -- tests/code-block.test.jsx --run -t 'TC-0514' --reporter=verbose`
  — **1 passed, 3 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent code-block suite:
  `npm test -- tests/code-block.test.jsx --run --reporter=verbose`
  — **4 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.97s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. The inline span remained an ordinary `code`
  element with text `inline`; no fenced figure, numbering, language bar, or
  copy control was introduced. No product gap or unrelated rendering change was
  found.
- Committed files are limited to this report and
  `tests/code-block.test.jsx`; `node_modules` remains an untracked symlink.
