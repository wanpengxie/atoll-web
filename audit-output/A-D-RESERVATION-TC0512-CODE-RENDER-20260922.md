# A–D reservation — TC-0512 / AD-218 code-block rendering contract

## Reservation

- **Case key:** `TC-0512` (A–D alias `AD-218`)
- **Baseline:** `fae8b70:tests/code-block.test.jsx:18`
- **Baseline title:** `渲染顶栏（语言 + 复制）、高亮 token，并保留 pre > code 结构与原文`
- **Current base:** `65452ed6fdea7af948c9fa40698980f844ea8736`
- **Branch:** `unit-a-d/tc0512-code-render-65452ed`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0512-code-render-65452ed`
- **Allowed change:** this report and the existing declaration in `tests/code-block.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user can read a fenced Go code block with its language label, syntax tokens,
faithful source text, and stable `pre > code` structure, then press the visible
copy action and receive exactly the code body without Markdown fences. The copy
label settles to the user-visible confirmation after the clipboard promise
resolves.

The invariant is one pure `MarkdownContent` → `CodeBlock` rendering path: the
language label, highlighted token projection, source text, line-number decision,
and copy action must agree with the same parsed code body. Rendering does not
invent a second code representation or mutate product state. The current public
owner is the exported `MarkdownContent`/`CodeBlock` composition in
`src/ui/MarkdownContent.jsx` and `src/ui/CodeBlock.jsx`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0512`
   row for `tests/code-block.test.jsx:18`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0512`, `TC0512`, `AD-218`, `AD218`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. The preceding TC-0511/AD-217 claim covers only the language helper mapping at
   line 11. This claim covers the separate rendering declaration at line 18 and
   does not duplicate it or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and observable assertions: render the fenced Go
source through `MarkdownContent`, verify the figure/data language, label,
pre/code text, highlighted tokens, and absence of line numbers for four lines;
then invoke the visible copy button and await the `已复制` label while asserting
the clipboard receives the code body. If the current public composition cannot
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

- The existing public declaration is tagged `[TC-0512][AD-218]` without changing
  its setup or assertions. It continues to exercise the public
  `MarkdownContent` → `CodeBlock` composition.
- Focused case:
  `npm test -- tests/code-block.test.jsx --run -t 'TC-0512' --reporter=verbose`
  — **1 passed, 3 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent code-block suite:
  `npm test -- tests/code-block.test.jsx --run --reporter=verbose`
  — **4 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.76s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. The user-visible language bar, Go syntax tokens,
  faithful `pre > code` text, and resolved copy body all remain correct; the
  copy confirmation settles after the clipboard promise. No product gap or
  unrelated rendering change was found.
- Committed files are limited to this report and
  `tests/code-block.test.jsx`; `node_modules` remains an untracked symlink.
