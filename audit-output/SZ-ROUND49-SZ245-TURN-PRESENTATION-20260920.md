# S–Z Round 49 — SZ-245 turn-presentation owner handoff

Date: 2026-09-20
Scope: one non-Feed/non-Reading-visibility S–Z baseline. `SZ-149` remains
OPEN for its separate product decision and is not re-audited here. No product
file was changed.

## Case contract

`SZ-245` is the exact fae8b70 case from
`tests/turn-presentation.test.js`:

> summarizes business progress without flattening technical evidence into the main line

The user must be able to read the current human-facing progress in the answer,
while tool/stage observations remain available as a separate process trail.
The invariant is that a tool observation cannot silently become the main answer
text, and expanding the process affordance must still expose the technical
facts.

## Current public owner

The deleted `src/model/turn-presentation.js` helper is not restored. The current
public presentation owner is
`useTimelineRowRenderer(...).renderRow` in
`src/ui/timeline/TimelineRowRenderer.jsx`:

- `AgentAnswer` renders `stage:text` observations as `.agent-progress-text`;
- `ProgressTrail` renders tool and non-text stage observations in the separate
  running process affordance;
- expanding that affordance exposes the process rows without adding them to the
  answer body.

The successor test drives this public renderer hook, not an inline/private
helper: [tests/sz-round49-turn-presentation-owner.test.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round49-turn-presentation-owner.test.jsx:1).

## Evidence

The direct owner scenario supplies a human progress observation (`正在整理报告`),
a thinking stage, and a started/ended search tool call. It proves:

1. the answer area contains only the human progress text;
2. the running process trail advertises the processing state and does not leak
   the answer text into the process summary;
3. expanding the same public affordance reveals `正在分析资料` and
   `tool: search 完成` as process rows.

Focused command:

```text
npx vitest run tests/sz-round49-turn-presentation-owner.test.jsx tests/message-presentation.test.js --reporter=dot
Test Files  2 passed (2)
Tests       5 passed (5)
```

This is a GREEN successor for the exact SZ-245 user capability. No source,
vendor, package, lockfile, old API, compatibility path, skip, or private export
was added. No Feed/Reading visibility owner was touched.
