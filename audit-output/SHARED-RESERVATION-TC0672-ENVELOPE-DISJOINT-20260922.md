# Reservation — TC-0672 / EH02-01 envelope status-set disjointness

## Claim

- **Case key:** `TC-0672` / `EH02-01` (E–H baseline; ledger owner `DATA`)
- **Baseline:** `fae8b70:tests/envelope.test.js:11`
- **Baseline title:** `keeps final and provisional status sets disjoint`
- **Current base:** `e532a9884953c015b33b3c5f6b3fb38f149d6d66`
- **Branch/worktree:** `unit-e-h/tc0672-envelope-disjoint-e532a98`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0672-envelope-disjoint-e532a98`
- **Allowed change:** the existing declaration in `tests/envelope.test.js` and this audit report only; no product source, package, lockfile, vendor, fixture, private export, skip, or unrelated test.

## Old behavior, user capability, and invariant

The historical case imports the public envelope status vocabulary and asserts
the exact final set (`completed`, `failed`), the exact provisional set
(`received`, `queued`, `processing`, `deferred`, `unavailable`), and that the
two sets have no intersection. The user capability is that a response cannot
be simultaneously presented as terminal and still-processing; downstream
history, Waiting, and notification projections can classify the same envelope
without conflicting lifecycle meaning. The strict observable is the complete
set equality plus the empty intersection assertion, not merely a positive
membership check.

## Current public owner and invariant

The sole public owner is
[`src/protocol/envelope.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0672-envelope-disjoint-e532a98/src/protocol/envelope.js:1),
which exports the canonical `FINAL` and `PROVISIONAL` sets consumed by
[`tests/envelope.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0672-envelope-disjoint-e532a98/tests/envelope.test.js:1).
No frontend projection, private helper, second vocabulary, or compatibility
alias is introduced. The case remains a direct public-module contract.

## RESTORE-ledger and uniqueness check

The RESTORE ledger was checked before this reservation. Its protocol-related
`AD-253`/contract-fixture entry covers the feed envelope's closed field
vocabulary and `channel_id` identity, not the `FINAL` versus `PROVISIONAL`
status sets. The already claimed `TC-0547` is that same distinct
contract-fixture vocabulary case; it does not own this declaration. Searches
over tracked tests, audit reports, all refs, branches, worktrees, and commit
messages found no `TC-0672`, `EH02-01`, or this baseline title reservation or
successor. This claim owns only the four status-set assertions in
`tests/envelope.test.js:11`.

## Reservation

Only the explicit `[TC-0672][EH02-01]` label and this report change. The exact
imports, final/provisional values, set-equality assertions, and empty-
intersection assertion remain unchanged in meaning. Closeout will append
focused, adjacent, and build evidence with the final disposition.

## Closeout

- **Reservation commit:** `2d4cbaf` (`claim TC0672 envelope status baseline`).
- **Focused:** `npm test -- tests/envelope.test.js --run -t 'TC-0672' --reporter=verbose` — `1 passed` (3 Vitest selection skips; no declarations were skipped).
- **Adjacent protocol suites:** `npm test -- tests/envelope.test.js tests/frame-fields.test.js tests/frame.test.js --run --reporter=dot` — `14 passed`.
- **Build:** `npm run build` — passed; Vite retained its existing advisory about chunks larger than 500 kB.
- **Diff hygiene:** only the `[TC-0672][EH02-01]` declaration and this audit report changed; the exact `FINAL`/`PROVISIONAL` values, equality checks, and empty-intersection assertion are unchanged in meaning. No product, package, protocol, fixture, skip/filter, private oracle, or compatibility change was introduced.
- **Disposition:** **PASS / MIGRATED**; **credit: 1**. The canonical public envelope vocabulary keeps terminal and provisional lifecycle statuses disjoint, preserving unambiguous downstream classification.
