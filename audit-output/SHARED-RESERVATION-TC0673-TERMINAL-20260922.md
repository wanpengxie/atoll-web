# Reservation — TC-0673 / EH02-02 terminal response classification

## Claim

- **Case key:** `TC-0673` / `EH02-02` (E–H baseline; ledger owner `DATA`)
- **Baseline:** `fae8b70:tests/envelope.test.js:17`
- **Baseline title:** `only treats final responses as terminal`
- **Current base:** `2ed64defffb7ed20874fc23d298789a86e70aa2f`
- **Branch/worktree:** `unit-e-h/tc0673-terminal-2ed64de`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0673-terminal-2ed64de`
- **Allowed change:** the existing declaration in `tests/envelope.test.js` and this audit report only; no product source, package, lockfile, vendor, fixture, private export, skip, or unrelated test.

## Old behavior, user capability, and invariant

The historical case sends four canonical envelope shapes to the public
terminal classifier: a completed response, a failed response, a processing
response, and a completed event. The observable result is `true`, `true`,
`false`, and `false`, respectively. The user capability is that the UI and
history lifecycle close a request only for a final response; an in-progress
response remains open and an event carrying a similar status cannot
accidentally close it. The invariant is both halves of the discriminator:
`kind` must be `response` and the canonical body status must belong to the
closed `FINAL` set. The test retains all four setup/action/observable
assertions, rather than proving only final-status membership.

## Current public owner and invariant

The sole public owner is
[`src/protocol/envelope.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0673-terminal-2ed64de/src/protocol/envelope.js:1),
whose exported `isTerminal` calls the canonical `argsOf` body parser and
requires `kind === response` plus membership in the public `FINAL` set. The
case directly exercises that public export from
[`tests/envelope.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0673-terminal-2ed64de/tests/envelope.test.js:17).
No private helper, frontend projection, second status owner, compatibility
shape, or mocked success path is introduced.

## RESTORE-ledger and uniqueness check

Before reservation, the E–H case ledger, RESTORE ledgers, tracked tests,
audit reports, all refs, branch names, worktree names, and commit subjects
were searched for `TC-0673`, `EH02-02`, and the exact baseline title. No
reservation or successor was found. The protocol RESTORE entry `AD-253` and
its `TC-0547` successor cover the feed envelope's closed field vocabulary;
they do not classify response/event terminality. The neighboring
`TC-0672` / `EH02-01` reservation covers only exact `FINAL` and `PROVISIONAL`
set membership and disjointness at `tests/envelope.test.js:11`; it does not
claim the response-kind and terminal-result behavior at line 17. This claim
owns only that four-assertion declaration.

## Reservation

Only the explicit `[TC-0673][EH02-02]` label and this report change. The
imports, canonical envelope bodies, response/event discriminator, and all
four expected results remain unchanged in meaning. Closeout will append
focused, adjacent, and build evidence with the final disposition.

## Closeout

- **Reservation commit:** `ff25b3c` (`claim TC0673 terminal response baseline`).
- **Focused:** `npm test -- tests/envelope.test.js --run -t 'TC-0673' --reporter=verbose` — `1 passed`, with the three unrelated declarations selection-skipped by the grep (no declaration was changed to skip).
- **Adjacent protocol suites:** `npm test -- tests/envelope.test.js tests/frame-fields.test.js tests/frame.test.js --run --reporter=dot` — `14 passed`.
- **Build:** `npm run build` — passed; Vite retained its existing advisory about chunks larger than 500 kB.
- **Diff hygiene:** final source diff is limited to this report and the one `[TC-0673][EH02-02]` declaration in `tests/envelope.test.js`; the four canonical inputs and expected results are unchanged in meaning. No product, package, lockfile, protocol, fixture, skip/filter, private oracle, or compatibility change was introduced.
- **Disposition:** **PASS / MIGRATED**; **credit: 1**. The public `isTerminal` owner preserves the strict response-kind plus final-status gate, so processing responses and completed events cannot close a request.
