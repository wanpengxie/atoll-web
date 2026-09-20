# S-Z round 34 — Timeline system-event renderer owner closure

Date: 2026-09-20

Scope: repair `SZ-059`, `SZ-060`, and `SZ-061` at the existing
`TimelineRowRenderer`/StructuredResult presentation boundary. The repair is
limited to the current renderer owner and its direct tests. Workspace,
Composer, Reading, Vendor, package, lockfile, and old system-event modules are
out of scope.

## Root cause and invariants

The red behavior had one owner boundary but three missing invariants:

1. `Narration` previously treated every system row as `sender + textOf()` and
   had no closed decoder for the three narration words. A valid member fact
   could not become member-specific language, and standard members were never
   filtered.
2. `textOf()` read arbitrary `text` before the system label table. A payload
   could therefore override a typed system word with attacker-controlled
   prose.
3. `Narration` fell back to `envelope.type`, exposing a wire type when no
   body was available.

The preserved invariants are:

* only canonical `payload.body` facts are read; flat historical payloads remain
  silent and are not reparsed;
* `system.member.created`, `system.member.deleted`, and
  `system.channel.inbound` accept only their documented fields and invalid
  facts receive safe diagnostic language;
* typed system presentation runs before arbitrary text, so `text` cannot
  override a canonical label;
* member facts use `isStandardActorIdentity`: ordinary members are mapped to
  product language and standard actors such as `svcactor` are hidden; and
* StructuredResult remains the existing terminal-result owner with its
  recursive redaction/title behavior; no second presentation owner or private
  export is introduced.

## Product change

The current renderer now contains a small closed decoder and presentation
policy:

* [`decodeSystemEvent` and its closed decoder table`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:127)
  validate member-created/member-deleted/channel-inbound facts through
  `argsOf()` and reject missing required fields;
* [`systemEventPresentation`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:189)
  maps `Steward 已加入频道` / `Steward 已离开频道`, joins channel-inbound
  language, emits safe invalid/unknown diagnostics, and hides standard member
  identities;
* [`textOf`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:232)
  requires the canonical body and gives typed system presentation precedence
  over `textContent`; and
* [`Narration`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:566)
  renders only the safe presentation, with no raw wire-type fallback.

The round-34 direct owner test asserts the explicit current boundary—silent
ignore—for a flat payload at
[`sz-round33-timeline-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round33-timeline-owner.test.jsx:117).
No compatibility parser was restored. The older exploratory
`message-body-presentation` probe still carries its historical opposite
expectation and was not changed or included in the closure run.

## Case closure

| Row | Contract proof | Result |
|---|---|---|
| SZ-059 | The direct owner suite decodes valid member and channel-inbound facts, rejects malformed member facts, and emits `后台状态已更新` for an unknown system event. | **GREEN** — current public Timeline owner now provides closed typed validation and safe unknown handling. |
| SZ-060 | Valid typed facts containing `text: "伪造标题"` keep the canonical member/channel title; unknown and malformed facts never expose that field. | **GREEN** — arbitrary JSON fields cannot override typed system language. |
| SZ-061 | A named `steward` member becomes `Steward 已加入频道`; a `svcactor` member row is omitted; deletion preserves the typed reason. | **GREEN** — canonical member mapping and standard-actor hiding are owned by the same renderer. |

Direct cases are in
[`sz-round33-timeline-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round33-timeline-owner.test.jsx:28):
seven tests cover the three decoder words, malformed/unknown facts, arbitrary
text, standard actor hiding, and flat-payload silence. Existing StructuredResult
coverage remains unchanged and continues to exercise the public renderer path.

## Verification

Focused Timeline/StructuredResult and adjacent Replica owner tests:

```text
npx vitest run tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
Test Files  5 passed (5)
Tests       25 passed (25)
```

Production build:

```text
npm run build
✓ built in 6.79s
```

The build emitted only the existing large-chunk advisory. No Workspace,
Composer, Reading, Vendor, package, lockfile, old module, compatibility path,
or central migration ledger was changed.
