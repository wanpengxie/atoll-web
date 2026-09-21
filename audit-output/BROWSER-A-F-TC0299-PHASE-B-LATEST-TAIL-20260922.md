# Browser A–F — TC-0299 / B-BR-02a latest-tail continuity after refresh

Date: 2026-09-22
Exact base snapshot: `0463c2f761c0a5785014a6ee0db700e6661405fc`

## Atomic claim and dedupe

This packet claims one previously uncredited migration baseline:

- key: **TC-0299**;
- baseline declaration: `fae8b70:tests/browser/phase-b.spec.js:115`;
- user label: **B-BR-02a 刷新进入频道后固定在最新处，后台历史预取不推动页面**;
- migration ledger row: `audit-output/TEST-CASE-MIGRATION-LEDGER.md:650`;
- first public owner boundary: ConversationSurface's public Reading viewport and
  its feed-hydration handoff; the visible latest position is owned by the
  mounted `.timeline-message-list` surface.

An exact-key/source search across current refs, worktrees, audit reports, and
browser tests found no earlier TC-0299 claim or successor. TC-0297 is the
separate stale/reconnect contract; TC-0298 is separately reserved for delayed
OBS/cache-first paint; and the existing F7/history contracts cover prepend,
cache, and live-arrival behavior rather than this refresh-at-latest invariant.

## Preserved public contract

The successor retains the old public journey on `multi-channel` seed `812`:

1. sign in as `root` and enter the public `动态` view;
2. reload the channel and wait for visible `OPEN`, a mounted `频道动态`
   region, and at least one public presentation row;
3. sample the public scroll region for 30 × 50 ms frames;
4. require every sample to remain at the latest position (bottom gap ≤ 2 px),
   keep rows present, and preserve both physical scroll height and mounted row
   count across the sample window.

The old `.timeline-entry` selector no longer exists in the current renderer, so
the successor uses the semantic public `频道动态` region and
`data-presentation-row-id` row identity while preserving the exact geometry and
stability thresholds. No private state, diagnostic marker, source inspection,
or selector-only result is an acceptance gate.

## Owner boundary

The first user-visible handoff is the ConversationSurface/Reading viewport:
refresh and feed hydration must keep the active public viewport in following mode
and must not replace its latest-tail position while cached or historical content
settles. The test does not assert internal Reading state or writer identity.

## Exact verification

Successor: `tests/browser/tc0299-phase-b-latest-tail.spec.js`.

```text
ATOLL_TEST_WEB_PORT=17109 ATOLL_TEST_MOCK_PORT=26109 \
npx playwright test tests/browser/tc0299-phase-b-latest-tail.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed (22.4s)** on exact Chromium. All 30-frame samples in each
repeat stayed within the ≤2 px latest-tail gap, retained public presentation
rows, and kept physical scroll height and mounted row count constant.

`npm run build`: **PASS** (Vite, 4306 modules). No product, vendor, package,
fixture, or existing test file is changed by this packet.
