# Browser T–Z — TC-0309 / B-BR-09 understandable results

## Contract

The fae8b70 baseline contract is `tests/browser/phase-b.spec.js` B-BR-09:
structured results, empty success, failure, and sensitive fields must all have
an understandable public presentation. The structured result initially keeps
the sensitive `instance_id` out of the visible body, while expanding the
result exposes the redacted field and a bounded array summary. Empty success
must visibly complete, and a failed operation must expose the user-facing
failure message, stable error code, and explanatory detail.

## Claim and scope

The current branch, tracked browser specs, audit output, and registered
worktree branches were searched for TC-0309, B-BR-09, and equivalent
structured/empty/failure browser claims. No existing TC-0309 successor or
competing claim was found. TC-0308 was the preceding T–Z claim and TC-0310 was
already reserved by A–D. Work was performed in independent branch
`codex/browser-tz-tc0309-f8e625a` at base `f8e625a`.

Only the dedicated browser spec and this report are changed. Product source,
mock, vendor, package, lockfile, and snapshots are untouched.

## Executable successor

`tests/browser/tc0309-phase-b-understandable-results.spec.js` executes the
three public user paths from the baseline:

1. `message-structured-success`: submits through the visible Composer,
   verifies the visible `结构化结果`, confirms `instance_id` is hidden before
   expansion, expands the public details disclosure, and verifies the field is
   represented as `已隐藏`. The current renderer presents the historical
   “25 项，先显示 20 项” semantics as a `25 项` total plus exactly 20 visible
   array-item nodes; the test asserts both facts rather than relying on the
   old combined copy string.
2. `message-empty-success`: submits through the visible Composer and asserts
   the public completion acknowledgement contains `已完成`.
3. `message-failed`: submits through the visible Composer and asserts the
   user-facing `接收方不支持这个操作`, stable `type_unsupported` code, and
   explanatory `mock failure requested` detail.

The oracle uses public roles, visible text, and the public structured-result
disclosure only. It does not read diagnostics, React state, IndexedDB, wire
frames, or private journals.

## Verification

Command:

```text
ATOLL_TEST_WEB_PORT=15189 ATOLL_TEST_MOCK_PORT=18839 \
  npx playwright test tests/browser/tc0309-phase-b-understandable-results.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3/3 passed** (`27.5s`).

Production build: **passed** (`4306 modules`; existing large-chunk warning
only).

## Verdict

**PASS / product contract preserved.** Structured, empty-success, failure, and
redacted result behavior are publicly understandable and stable across three
fresh browser repetitions. No product gap or environment blocker was
observed.
