# TC-0326 / D-BR-05 retirement handoff fix

- Base: `c7649ae8d0fdabaf400df18b6827ef4331747c31`.
- Red oracle: `7a80493693a57eacc32647dc2186c0cb86df210a`; five Chromium repeats stayed on `c0.project` after the authoritative retirement and logged a React uncaught `qualified_name` read while Governance received a null channel.
- First public owner: `useChannelNavigation` owns the active directory/selection handoff; `ChannelAdministrationPanel`/`ChannelOverview` owns the channel projection.
- Fix: navigation excludes retired rows from its selectable directory, falls back to the first valid member channel, clears the stale panel on an existing-channel handoff, and safely renders the transient null Governance projection. No frontend authority, store, backend, or protocol was added.
- Public contract: ordinary `c0.project` retirement requires exact confirmation, then returns to `c0`, removes the retired channel from the rail, and leaves the composer available.

Verification on this worktree:

- `ATOLL_TEST_WEB_PORT=17133 ATOLL_TEST_MOCK_PORT=26133 npx playwright test tests/browser/tc0326-phase-d-retire-channel.spec.js --repeat-each=5 --workers=1 --reporter=line`: **5/5 passed**.
- Focused Vitest (`governance-feature-owner`, roster, governance member port, workspace governance): **5 files / 28 tests passed**.
- Adjacent TC-0324/TC-0330 browser repeat2 and build are run before commit.
