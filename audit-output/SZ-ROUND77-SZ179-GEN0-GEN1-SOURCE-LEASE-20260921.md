# SZ-179 — gen0 cache-to-gen1 source-lease reacquisition

Date: 2026-09-21  
Base: `0710d5852a2983459575138259c79918333b525f`  
Owner: `useConversationProjection` → `useHistoryConsumer` viewport; the
history source lease and supply obligation remain Feed-owned facts.  
Test: `tests/sz179-cache-source-lease-public-owner.test.jsx`

## Contract

When the local cache starts with a zero-row projection, the current public
owner issues one anticipatory `projection-underfill` request. If a gen1 source
lease becomes current while the gen0 request is still pending, the old result
must not consume or seal gen1's zero-row supply obligation. Once the gen0
operation settles, the owner must issue exactly one gen1 request with the
current source facts and the existing public view specification.

## Evidence

The test uses the current public `useConversationProjection` owner with a
zero-row Replica/Presentation state. It starts with detached generation 0 and
source lease `1:2:9`, observes one anticipatory request, then publishes
attached generation 1 and lease `1:3:10` while the first promise remains
pending. No duplicate request is emitted during the handoff. Settling the
gen0 promise as `cancelled` causes exactly one second request, still carrying
`reason: projection-underfill`, anticipatory urgency, and the same public
`scope: mine`/`selfId` view specification. The final public viewport status
is generation 1, attached, and lease `1:3:10`.

The test reads only `viewport.status` and the injected public request port;
it does not inspect private refs, operation ledgers, or retired APIs.

## Result

Focused Vitest: PASS (1 test). Product source unchanged; this is a public
owner contract migration from the retired integration case.
