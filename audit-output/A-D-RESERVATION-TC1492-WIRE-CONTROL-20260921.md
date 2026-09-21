# A–D reservation — TC-1492 / wire control-origin contract

## Atomic claim

- **Canonical central-ledger key:** `TC-1492`
- **Baseline identity:** `fae8b70:tests/wire.test.js:377`
- **Exact baseline title:** `别的词一个字都不加——控制命令和 system 词都不盖`
- **Reservation base:** `6a2a377ad8d4e73dd494b1bff9a3c53d763f59e9`
- **Reservation branch/worktree:** `unit-a-d/tc1492-wire-control-origin-6a2a377` / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc1492-wire-control-origin-6a2a377`
- **Reservation state:** `RESERVED — not PASS, not credit, not a product fix`

## User contract and current public owner

- **User capability:** sending a control or system word from a screen must not
  silently add that screen's origin metadata to the request body. Only the
  user-facing `agent.ask` body carries the originating screen context.
- **Invariant:** origin stamping is type-scoped at the transport boundary;
  `agent.interrupt`, `agent.dismiss`, `agent.fork`, and `system.member.list`
  retain the exact caller payload without a second transport or fallback
  mutating it.
- **Unique public owner:** `createWire`'s public `wire.submit` path, exercised
  through the public `FakeWebSocket` protocol fixture. No private hook export,
  legacy App path, or second origin store is an equivalent owner.
- **Baseline setup/action/result:** attach a v5 wire with a session/label,
  submit each of the four control/system message types with `{}` payload, and
  assert the serialized submit payload remains `{}` for every type.

## Uniqueness checks

1. The central read-only 1,502-row migration ledger has one executable row for
   this exact source/title at ledger line 1,843 (`TC-1492`).
2. A repository-wide search of `audit-output/` found no dedicated
   `TC-1492`/`wire.test.js:377` reservation, migration, candidate, or review
   packet outside this file. Existing `wire` reports cover adjacent
   `TC-1487`–`TC-1491` contracts and do not claim this exact declaration.
3. No local or remote branch name contains `tc1492`; no worktree was already
   reserved for this exact baseline before this branch was created.

This reservation claims exactly one declaration. It does not claim the
adjacent `agent.ask` origin cases (`TC-1491` and `TC-1493`/`TC-1494`) or any
other wire/feed behavior.

## Allowed work boundary

The implementation packet may add or migrate only the public test evidence and
this audit under `tests/` and `audit-output/`. Product source, vendor,
package/lockfile, private exports, compatibility layers, and second owners are
out of scope. If the current public contract is red, preserve the exact first
owner failure as a regression packet; do not weaken the assertion or repair
unrelated Feed/Replica behavior.

## Current verification and disposition

The current tracked `tests/wire.test.js` already contains the exact public
contract in the `人说的那句话盖上从哪块屏说的` suite. No duplicate declaration
was added: the source test is the one-to-one successor evidence for the central
baseline row.

Focused command:

```text
npm test -- tests/wire.test.js --reporter=verbose --testNamePattern='别的词一个字都不加'
Test Files  1 passed
Tests       1 passed | 19 skipped (20)
```

Adjacent owner regression command:

```text
npm test -- tests/wire.test.js --reporter=verbose
Test Files  1 passed
Tests       20 passed (20)
```

The focused case and the full wire owner suite both pass. `npm run build` also
passes. The first owner is therefore green on the current base; no
`createWire`, Feed, Replica, package, lockfile, vendor, private export, or
compatibility change is justified. This reservation closes as **PASS / audit
only**, with no expected-fail or adjacent-case credit.
