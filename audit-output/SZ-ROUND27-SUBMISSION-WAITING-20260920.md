# S–Z round 27 submission / Waiting owner evidence

Date: 2026-09-20

This round selects the next ten genuinely unproven baseline contracts,
SZ-001–SZ-010, all from the former `send-scroll-transaction` suite. The
settled-observation fixture gap is deliberately excluded. The old target path
and `src/model/send-scroll-transaction.js` are absent in the current tree, so
these rows remain OPEN; no compatibility module or private export is restored.

The adjacent current Waiting queued/processing/terminal owner was also run as
a safety check, but its already-green ledger rows are not counted again.

## Current Waiting / processing / terminal evidence (not new ledger closures)

The public owner tests passed **8 files / 58 tests**:

```text
npx vitest run \
  src/model/feature-tasks.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/waiting-currentness-public.test.jsx \
  src/ui/timeline/waiting-presentation.test.jsx \
  tests/agent-information-architecture.test.jsx \
  tests/submission-outbox.test.jsx \
  tests/mock-phase-c.test.js \
  tests/terminal-feature.test.jsx --reporter=dot

Test Files  8 passed (8)
Tests       58 passed (58)
```

The evidence is bounded to existing public owners:

- `feature-tasks` proves canonical processing controls carry typed payloads and
  reject missing target authority at
  `src/model/feature-tasks.test.js:44-127`.
- `waiting-presentation` proves explicit queued facts, stable local/canonical
  identity, processing release, no-provisional exclusion, and terminal
  suppression at `src/ui/timeline/waiting-presentation.test.jsx:54-132`.
- `TasksFeature`/currentness tests prove cached facts remain readable while
  stale tail/roster authority hides controls, and current authority restores
  them at `tests/feature-waiting-controls.test.jsx:31-112` and
  `tests/waiting-currentness-public.test.jsx:128-168`.
- `agent-information-architecture` and `TerminalFeature` prove processing
  presentation, terminal wording, and terminal-session input/control behavior.

These passing successors do not prove the ten retired send-scroll contracts
below, and no Waiting row is reclassified by this packet.

## Ten retained submission OPEN contracts

The old baseline source is recorded in
`audit-output/TEST-CASE-MIGRATION-LEDGER.md:1520-1529` as a missing target path.
The current `useComposerSubmissionRuntime` and Composer correlation ports own
submission transport, but they do not expose the old scroll-transaction
authority/geometry contract. Each row therefore remains an independent OPEN
handoff rather than being called obsolete or a product RED.

| case | user capability / invariant | current public owner check | disposition |
| --- | --- | --- | --- |
| SZ-001 | Every required send phase joins into one send-ready authority before the write. | Current Composer submission owns transport pending/receipt state; no public send-scroll phase owner or successor exports this authority join. | **OPEN — hand off** |
| SZ-002 | A committed queued destination can be used as the send-intent write. | Current Composer has typed send/reconcile ports, but no send-scroll destination-intent observable. | **OPEN — hand off** |
| SZ-003 | A mixed batch joins every target destination before the send write. | No current public target-batch/scroll-intent owner; do not infer from Composer outbox reconciliation. | **OPEN — hand off** |
| SZ-004 | A later same-id stream is not suppressed when the destination is the timeline. | Current feed reconciliation preserves submission identity, but no public same-id timeline destination contract proves this rule. | **OPEN — hand off** |
| SZ-005 | A stale destination acknowledgement cannot replace a newer ready revision. | No current send-scroll revision owner; Composer receipt correlation is adjacent but not equivalent. | **OPEN — hand off** |
| SZ-006 | An earlier target-row measurement joins later metadata-only timeline readiness. | `VendorListExecutor` observes DOM rows, while Composer owns send lifecycle; no single public successor joins these facts. | **OPEN — hand off** |
| SZ-007 | An unrelated post-baseline layout measurement cannot be mistaken for target geometry. | Current DOM observation has its own typed Reading fence, not a send target-geometry owner; no one-to-one proof exists. | **OPEN — hand off** |
| SZ-008 | A later same-revision target measurement wins when measured height decreases. | No public send-scroll measurement revision port; current row measurement contracts are separate from send readiness. | **OPEN — hand off** |
| SZ-009 | A committed Waiting destination is allowed while the list stays at its baseline revision. | Waiting presentation exposes canonical queued facts, but no send-intent/geometry owner proves baseline-revision admission. | **OPEN — hand off** |
| SZ-010 | User takeover or activation replacement invalidates the transaction before the write. | ReadingSession and Composer each own their own epochs, but no public send-scroll transaction owner proves this pre-write invalidation. | **OPEN — hand off** |

No source, vendor, package, lockfile, private export, compatibility layer, old
test, or skipped declaration was changed. The existing tracked dirty browser
Waiting test belongs to another owner and was left untouched.
