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

- **Reservation commit:** pending.
- **Focused:** pending.
- **Adjacent protocol suites:** pending.
- **Build:** pending.
- **Diff hygiene:** pending closeout verification; the allowed boundary is the one test declaration plus this report.
- **Disposition:** pending focused verification; no unresolved case is hidden by this reservation.
