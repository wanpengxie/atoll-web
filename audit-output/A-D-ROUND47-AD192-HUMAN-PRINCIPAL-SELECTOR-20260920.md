# A–D Round 47 — AD-192 human-principal selector recovery (2026-09-20)

Round 47 selects AD-192 because its current GovernanceFeature owner is public
and independent of Reading, Feed, and visibility state. The former ordinary
red was a selector-fixture mismatch: the current `SelectMenu` deliberately
renders an empty placeholder as an option, while the capability concerns which
registry principals are admitted as candidates.

## Current public owner contract

| Boundary | Public fact | Required invariant |
|---|---|---|
| Shell route | `WorkspaceRightPanel` dispatches the channel-administration context to `GovernanceFeature.ChannelAdministrationPanel`. | The selector consumes the typed governance port supplied by the current Workspace owner; it does not read a private registry or create a second candidate store. |
| Candidate projection | `ChannelMembers` maps `port.principals` through `eligiblePrincipal` and excludes principals already represented by the visible roster. | Only rows with `kind === 'human'`, `status === 'present'`, and an id become human-principal candidates. Agent and retired-human rows cannot be submitted as human targets. |
| UI option boundary | `SelectMenu` prepends the user-facing empty placeholder to its options. | The placeholder is not a registry candidate; the behavioral assertion must distinguish it from admitted principal options. |

The current owner evidence is `GovernanceFeature.jsx:86-93` for the defensive
principal predicate and `:143-154` for the `ChannelMembers` projection. No
private helper is exported or imported by the test.

## Case record and evidence

| Case | User capability | Invariant | Public owner | Baseline setup/action/result | Current result/disposition |
|---|---|---|---|---|---|
| AD-192 | In channel member governance, a user can choose a real human principal but cannot admit an Agent or retired human as a human target. | Principal kind/status filtering is applied at the public candidate boundary; UI placeholder state is not mistaken for a principal. | `WorkspaceRightPanel → ChannelAdministrationPanel → ChannelMembers` | Supply `root` human/present, `steward` agent/present, and `retired` human/retired; open the 成员 tab and participant selector; expect only `root · 用户` as a candidate. | **PASS:** the migrated assertion finds `root · 用户`, excludes `/steward/` and `/retired/`, and intentionally ignores the SelectMenu placeholder. Evidence: `tests/blocked-round26-public-owner.test.jsx:407-426`. Focused latest-head run at `97ba8dc`: **1 passed, 19 skipped**. |

## Verification

```text
npx vitest run tests/blocked-round26-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-192\\]'

Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

The old assertion compared every `role=option` label with `['root · 用户']`,
which incorrectly counted the public empty placeholder. The replacement keeps
the exact user capability and rejects both forbidden principal classes without
weakening or hiding the selector behavior. No product source was changed in
this pass; the current GovernanceFeature owner is exercised as-is.

The A–D ledger moves from **330 PASS / 0 REGRESSION / 35 BLOCKED** to
**331 PASS / 0 REGRESSION / 34 BLOCKED**. No test was deleted, skipped, or
converted to expected-fail; no private export, compatibility API, vendor,
package, or lockfile changed.
