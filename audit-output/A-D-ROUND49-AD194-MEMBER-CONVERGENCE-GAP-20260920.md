# A–D Round 49 — AD-194 member ledger/roster convergence owner packet (2026-09-20)

Round 49 keeps AD-194 as a precise ordinary-red product-gap reproduction. It
does not promote or discard the baseline capability and does not modify the
Governance implementation.

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/channel-governance.test.js:48-53` — `actorConvergence` reports `ledger: true` and `rosterConverged: false` when the member is absent, and becomes ready only when the authoritative roster contains the actor (or the delete terminal's removal is reflected). |
| User capability | After adding a participant, a user can tell that the command was recorded separately from whether the member is actually present in the channel roster. |
| Invariant | A terminal command receipt cannot fabricate roster readiness. Ledger terminal and roster convergence are separate facts; a missing roster must stay not-ready. |
| Current public owner | `ChannelAdministrationPanel → ChannelMembers` in `src/ui/features/governance/GovernanceFeature.jsx:143-228`, consuming the typed channel `commands`, `roster`, `declarations`, and `refresh` ports. The public app route is supplied by `WorkspaceRightPanel` for the channel-administration panel. |
| Old action | Baseline member-create terminal was evaluated against an empty roster and then against a roster containing the created actor. |
| Current action | Render the public member panel with a present Agent declaration and an empty roster; select `Worker · Agent`, click `添加到频道`, observe the `introduce_actor` command, click the member `刷新`, then inspect the member-ready observable. |
| Current result | **RED / PRODUCT-GAP.** `submit` receives `{ scope: 'channel', action: 'introduce_actor', payload: { channelId: 'c0', candidateType: 'declaration', candidateId: 'agent:worker:1' } }`; the owner shows only the generic submitted message and an empty roster. No separate `成员已就绪` fact or equivalent public convergence projection exists, so the baseline assertion fails at `tests/blocked-round26-public-owner.test.jsx:463`. |
| Disposition | `PRODUCT-GAP/BLOCKED`; return to the Governance owner. This is an ordinary `it`, not `it.fails`/expected-fail, and is not counted as PASS. No product source, private export, old store, compatibility API, or baseline declaration changed. |

## Verification

```text
npx vitest run tests/blocked-round26-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-194\\]'

Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Failure    Unable to find an element with the text: 成员已就绪
```

The focused run also confirms the public command action before the failing
observable. The A–D ledger stays **332 PASS / 0 REGRESSION / 33 BLOCKED**.
