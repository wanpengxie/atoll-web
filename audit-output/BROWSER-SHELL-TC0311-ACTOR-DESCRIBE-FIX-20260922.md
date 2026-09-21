# Shell — TC-0311 Actor Describe metadata recovery

Date: 2026-09-22
Exact base: `a0e9c74d0ecfe9856f4cac5bcc8faf27cc0f7330`

## Owner and authority

The fae C-BR-01/02 journey opens the public channel roster, selects the
steward Actor, and reads its description and `actor.describe` capability
metadata. The current backend/mock contract already supplies the facts:

- `mock/domain.mjs:16-24` puts `description: "Mock collaboration agent"`
  in the declared roster item;
- `src/app/hooks/useChannelRoster.js:6-21` projects that declared field to
  the canonical public `actor.description` row;
- `src/app/hooks/useAgentProbes.js:28-44` parses the public describe terminal
  into typed capability descriptions and preserves the server error-code
  evidence in each capability's `raw` field.

The defect was therefore the final `ActorDetailPanel` projection, not a
missing fixture or a second authority. The product change is limited to
`src/ui/features/roster/RosterFeature.jsx`: it renders `actor.description`
and the already projected capability description/error-code rows. It does
not issue a new request, alter the probe/roster owner, or change mock,
backend, protocol, package, or vendor files.

## Public contract

`tests/browser/tc0311-actor-describe-metadata.spec.js` uses only the public
journey:

1. reset the `actor-capability` scenario and sign in;
2. open `成员` and select the visible `steward agent · mock:steward` row;
3. require `Mock collaboration agent`, `执行普通文本任务`,
   `provider_timeout`, and `创建一个 Mock 订单` in the Actor detail;
4. close the detail, reopen the member panel, refresh the public roster, and
   reopen the Actor to require the description again.

No private hook/store, websocket frame, diagnostic marker, fixture mutation,
or selector-only assertion is used.

## Verification

```text
ATOLL_TEST_WEB_PORT=17136 ATOLL_TEST_MOCK_PORT=26136 \
npx playwright test tests/browser/tc0311-actor-describe-metadata.spec.js \
  --repeat-each=5 --workers=1 --reporter=line
```

Result: **5/5 passed**.

```text
npm test -- --run tests/roster.test.js
```

Result: **15/15 passed**.

`npm run build`: **PASS** (Vite; 4306 modules transformed). The existing
large-chunk warning is unchanged.
