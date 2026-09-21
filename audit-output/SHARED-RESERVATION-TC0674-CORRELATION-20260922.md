# Reservation — TC-0674 / EH02-03 envelope correlation identity

## Claim

- **Case key:** `TC-0674` / `EH02-03` (E–H baseline; ledger owner `DATA`)
- **Baseline:** `fae8b70:tests/envelope.test.js:24`
- **Baseline title:** `uses correlation_id and falls back to id`
- **Current base:** `e233da0281aaf24cd73f9fc1c42d84c27e4566c0`
- **Branch/worktree:** `unit-e-h/tc0674-correlation-e233da0`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0674-correlation-e233da0`
- **Allowed change:** the existing declaration in `tests/envelope.test.js` and this audit report only; no product source, package, lockfile, vendor, fixture, private export, skip, or unrelated test.

## Old behavior, user capability, and invariant

The historical case supplies one envelope with an explicit `correlation_id`
and one envelope with only an `id`. The observable result is that the
explicit correlation is returned for the first input and the stable envelope
id is returned for the second. The user capability is that progress,
terminal, and projection rows can be associated with their durable request
when the protocol supplies a correlation, while an envelope without that
optional field still has a deterministic identity. The invariant is the
canonical precedence rule: a truthy `correlation_id` wins; otherwise the
envelope `id` is the fallback; neither case invents a second identity or
consults frontend state.

## Current public owner and invariant

The sole public owner is
[`src/protocol/envelope.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0674-correlation-e233da0/src/protocol/envelope.js:1),
which exports `correlationOf`. The existing declaration in
[`tests/envelope.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0674-correlation-e233da0/tests/envelope.test.js:24)
directly exercises that public function with both canonical inputs and exact
results. No private helper, second correlation owner, frontend projection,
compatibility fallback, or mocked success path is introduced.

## RESTORE-ledger and uniqueness check

Before reservation, the E–H case ledger, RESTORE ledgers, tracked tests,
audit reports, all refs, branch/worktree names, and commit subjects were
searched for `TC-0674`, `EH02-03`, and the exact baseline title. No prior
reservation or successor was found. The protocol RESTORE entry `AD-253` and
its `TC-0547` successor cover the feed envelope's closed field vocabulary and
channel identity, not correlation precedence. The neighboring `TC-0672` /
`EH02-01` claim covers only exact `FINAL`/`PROVISIONAL` sets, and
`TC-0673` / `EH02-02` covers response-kind plus final-status terminality;
neither owns the two `correlationOf` observations at line 24. This claim
owns only that declaration and its two assertions.

## Reservation

Only the explicit `[TC-0674][EH02-03]` label and this report change. The
imports, explicit correlation input, missing-correlation input, and both
expected identities remain unchanged in meaning. Closeout will append
focused, adjacent, and build evidence with the final disposition.

## Closeout

- **Reservation commit:** `f97565e` (`claim TC0674 envelope correlation baseline`).
- **Focused:** `npm test -- tests/envelope.test.js --run -t 'TC-0674' --reporter=verbose` — `1 passed`, with the three unrelated declarations selection-skipped by the grep (no declaration was changed to skip).
- **Adjacent protocol suites:** `npm test -- tests/envelope.test.js tests/frame-fields.test.js tests/frame.test.js --run --reporter=dot` — `14 passed`.
- **Build:** `npm run build` — passed; Vite retained its existing advisory about chunks larger than 500 kB.
- **Diff hygiene:** final source diff is limited to this report and the one `[TC-0674][EH02-03]` declaration in `tests/envelope.test.js`; the explicit correlation and id-fallback inputs and expected identities are unchanged in meaning. No product, package, lockfile, protocol, fixture, skip/filter, private oracle, or compatibility change was introduced.
- **Disposition:** **PASS / MIGRATED**; **credit: 1**. The public `correlationOf` owner preserves deterministic explicit-correlation precedence with a stable id fallback for envelopes that omit the optional field.
