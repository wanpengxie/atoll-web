# S-Z Round 35 — Timeline typed renderer audit and next baseline handoff

Date: 2026-09-20  
Owner: S-Z unit-test / Timeline presentation owner  
Scope: `acac6c8` (`fix(timeline): close SZ system event presentation contracts`)

## Decision

`acac6c8` remains sound for the current protocol surface. The closed decoder covers all three current `TYPES.narration` words, and the renderer has no wire/raw fallback for an unknown system event. Canonical typed facts are rendered only from their documented fields; a flat legacy payload remains silently ignored. No product source change was needed in this round.

## Closed decoder evidence

The current narration vocabulary is exactly:

| Protocol word | Decoder | Direct user-visible proof |
|---|---|---|
| `system.member.created` | `memberEvent(..., 'member_joined')` | canonical member joins as `Steward 已加入频道`; standard `svcactor` is hidden |
| `system.member.deleted` | `memberEvent(..., 'member_left')` | canonical member leaves with typed reason |
| `system.channel.inbound` | documented `from`, `type`, `local_request_id` fields | channel request is rendered from those fields only |

`TYPES.narration` is the three-word closed set in `src/protocol/vocab.js:41-45`; `SYSTEM_EVENT_DECODERS` has one entry for each at `src/ui/timeline/TimelineRowRenderer.jsx:144-155`. `decodeSystemEvent` treats an absent decoder as `unknown` and a malformed known fact as `invalid` (`src/ui/timeline/TimelineRowRenderer.jsx:157-163`). This is a typed decoder audit, not a claim that every unrelated `TYPES.*` operation is a narration fact; those continue through the existing closed system-operation label table.

## Safety and legacy evidence

- Unknown system event with `actor_id`, arbitrary `text`, `severity`, a wire token, and a nested password renders only `后台状态已更新`. The raw type, fake title, wire token, and nested secret are all absent from the DOM.
- Malformed `system.member.created` renders `无法识别的频道活动`; arbitrary `text` is not promoted to a title.
- A valid inbound event renders only its documented channel/request fields; an arbitrary `text` key is absent.
- A payload without canonical `payload.body` is hidden before decoding. `hasCanonicalBody`/`argsOf` therefore keep flat historical payloads silent; no compatibility parser was added.
- Canonical standard actor member events remain hidden by the existing visibility policy.

The direct cases are in `tests/sz-round33-timeline-owner.test.jsx:46-143`.

## Verification

Command:

```text
npx vitest run tests/sz-round33-timeline-owner.test.jsx tests/structured-result-restore.test.jsx tests/message-presentation.test.js tests/timeline-hides-housekeeping.test.jsx src/model/channel-replica-thread-structure.test.jsx --reporter=dot
```

Result: **5 test files passed, 25 tests passed**. The round-35 direct owner file passes all 7 cases, including the recursive unknown-field non-leak check.

## Next unique S-Z baseline package

The next unproven rows are the remaining S18 role/geometry contracts. They are retained as a regression handoff, not silently declared green:

| Case | Current owner finding | Disposition |
|---|---|---|
| SZ-143 — content and local layout decisions participate in the geometry key | Current `createConversationPresentation` publishes `contentRevision` and `layoutClass` on immutable rows, but does not export the former `presentationGeometryKey` contract. | **OPEN**; do not infer an exact geometry-key oracle from row fields. |
| SZ-144 — latest is admitted only from an exact authority token and role stays out of geometry | Current Presentation publishes `currentEntryCandidate`; the old authority-token/role finalizer is no longer a public owner. | **OPEN**; hand to the owner that can publish the exact authority contract. |
| SZ-146 — exact role deltas use a separate monotonic revision | `createConversationPresentation` exposes no role-delta owner or public role revision. | **OPEN**; retain rather than recreate the deleted role API. |
| SZ-148 — latest-role candidate is emitted exactly once after commit | Current candidate receipts are projection commits, not a latest-role candidate port. | **OPEN**; retain until a current public role owner exists. |

These four are distinct from the typed renderer cases above and from the Reading/Workspace/Composer packages. No old role API, compatibility layer, or private export was restored.

