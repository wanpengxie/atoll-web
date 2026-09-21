# A–D reservation — TC-0511 / AD-217 code-fence language mapping

## Reservation

- **Case key:** `TC-0511` (A–D alias `AD-217`)
- **Baseline:** `fae8b70:tests/code-block.test.jsx:11`
- **Baseline title:** `语言名和 prism 语法名的映射`
- **Current base:** `e409c5109b3fa5f99b176484c03b055404f1bda1`
- **Branch:** `unit-a-d/tc0511-code-language-e409c51`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0511-code-language-e409c51`
- **Allowed change:** this report and the existing declaration in `tests/code-block.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user views a fenced code block, the language class supplied by Markdown is
translated to the syntax-highlighter language consistently; an empty class stays
plain and aliases such as `py` and `bash` resolve to their documented public
Prism modes. The user does not need to know the internal parser/highlighter names.

The invariant is a pure, deterministic mapping at the CodeBlock/MarkdownContent
boundary: it does not mutate rendering state, invent an unsupported language, or
turn an empty/unknown input into a misleading syntax mode. The public owner is
the exported `fenceLanguageOf` and `prismLanguageOf` contract in `src/ui/CodeBlock.jsx`,
consumed by `MarkdownContent`; no private hook or test-only export is needed.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0511`
   row for `tests/code-block.test.jsx:11`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0511`, `TC0511`, `AD-217`, `AD217`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. The preceding `TC-0509`/`AD-215` and `TC-0510`/`AD-216` claims cover distinct
   Replica declarations. This claim does not duplicate them or any
   `TC-1493`/`TC-1494` row.

## Baseline-to-current plan

Retain the exact public setup and assertions: map `language-go` to `go`, keep an
empty class empty, map `py` to `python`, and map `bash` to the plain Prism mode.
If the current public mapping cannot express the baseline without importing a
private implementation detail, record that first boundary as a product/fixture
gap and do not change product code or broaden the API.

This is an atomic claim: the report is committed before changing the declaration.
Closeout will append exact focused/full test and build evidence, the
capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/code-block.test.jsx` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- The existing public declaration is tagged `[TC-0511][AD-217]` without changing
  its setup or assertions. It continues to exercise the exported CodeBlock
  mapping helpers used by `MarkdownContent`.
- Focused case:
  `npm test -- tests/code-block.test.jsx --run -t 'TC-0511' --reporter=verbose`
  — **1 passed, 3 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent code-block suite:
  `npm test -- tests/code-block.test.jsx --run --reporter=verbose`
  — **4 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.37s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. `language-go` maps to `go`, empty input remains
  plain, `py` maps to `python`, and `bash` resolves to the documented plain
  Prism mode. No product gap or unrelated rendering change was found.
- Committed files are limited to this report and
  `tests/code-block.test.jsx`; `node_modules` remains an untracked symlink.
