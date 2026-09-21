# Browser A–F #12 current re-verification

## Claim / de-duplication

- Canonical baseline: A–F migration ledger case **#12**, `tests/browser/e-send-scroll-writers.spec.js:325`, `browsing send hands off to the following owner with recorded writes`.
- This was the only A–F user-visible case still open after the prior A–F rounds; #1/#14/#18/#19/#27/#28/#29/#30/#31 had already been closed in the migration report. The earlier #12 run at `a3963f6` was a stable product red, so this is a current-owner re-verification of that open key, not a second case or a selector-only credit.
- Notification cases TC-0131–TC-0134 were not claimed here: they are covered by the notification lane (TC-0132 has an existing S–Z owner branch).

## Exact clean run

Snapshot: `c4906ca432ea9a25294a7e13f6a252b680273e6f` (`c4906ca`). The run used a detached clean worktree and the existing production test unchanged:

```text
ATOLL_TEST_MOCK_PORT=21913 ATOLL_TEST_WEB_PORT=15913 \
  npx playwright test tests/browser/e-send-scroll-writers.spec.js \
  --grep 'browsing send hands off' --workers=1 --repeat-each=5 --reporter=line
```

Result: **5 passed / 5**, `46.6s`.

An additional single run wrote the existing test's public geometry trace to `/tmp` (no repository fixture or assertion changes). It recorded:

| checkpoint | public evidence |
| --- | --- |
| before send | `mode=browsing`, `scrollTop=15490`, `scrollHeight=16778`, `clientHeight=387`, `gap=901` |
| after accepted send | `mode=following`, `scrollTop=16714`, `scrollHeight=17101`, `clientHeight=387`, `gap=0` |
| sent row | one `[data-presentation-row-id]` row, `painted=true`, intersects the viewport at `top=133.66` and `bottom=439.75` |
| writer/settle | one continuous displacement run, four native timeline writes, final target remains mounted and the jump affordance is empty |

The test keeps the strict public gates: real wheel input first establishes browsing; real composer send must paint the submitted row, return the public viewport to `following`, reach physical tail (`gap <= 24`), and record a timeline writer. No private diagnostic event name is used as a pass condition.

## Decision

**ACCEPT on exact `c4906ca` (current product path).** The prior open #12 product red is no longer reproducible at this exact clean snapshot. No product, vendor, package, fixture, selector, assertion, or threshold was changed in this verification.

