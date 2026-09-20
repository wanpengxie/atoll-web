# A–D Governance owner evidence — Round 35 (2026-09-20)

This packet records the next unique A–D baseline migration and the narrow
Governance create owner candidate. It does not add a duplicate ordinary-red
declaration for the remaining create gaps.

Focused verification:

```text
npx vitest run tests/channel-create-modal.test.jsx --reporter=dot
1 file passed; 1 test passed

npx vitest run tests/workspace-governance-features.test.jsx --reporter=dot
1 file passed; 3 tests passed

npm run build
passed
```

## Case-level record

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result and evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-149 | Open an independent create dialog, focus the name field, and submit a real child-channel create command. | Dialog focus/submit lifecycle belongs to the current Governance owner; a command receipt is only a request locator. | `WorkspaceRightPanel` → `GovernanceFeature.ChannelCreateModal`; command entry is `port.commands.submit`. | Open the create entry, expect the name field to be focused, enter `research`, submit, and observe the channel create command. | **PASS:** the public modal is rendered with the name field focused; the exact `scope: 'channel'`, `action: 'create_child'`, name, purpose, and parent id are submitted. After the receipt, the modal shows convergence and does not expose `进入新频道` without typed creation facts. Evidence: `tests/channel-create-modal.test.jsx:14`. | `MIGRATE/PASS`; canonical row updated in `RESTORE-CASES-A-D-20260919.md`. |
| AD-153 | Show ledger/OBS/membership/serving convergence independently and enter the new channel only after all are ready. | Acceptance, ledger terminal, OBS observation, membership, serving, and navigation are distinct facts; a same-name directory row or receipt cannot prove them. | `GovernanceFeature.ChannelCreateModal` consumes `port.creation`; Shell navigation must provide `commands.enterChannel`. | Submit a create request, drive each causal fact, then enter through the public navigation callback only when ready. | **BLOCKED:** the current mounted Workspace channel port returns only a submission id and child directory; it provides no typed `creation` projection or Shell `enterChannel` callback. The candidate now fails closed: it does not infer `accepted`/`ledger`/ready from the receipt or directory, does not write `globalThis.location.hash`, and reports the missing Shell contract. Evidence: `src/ui/features/governance/GovernanceFeature.jsx:258`, `src/app/WorkspaceApp.jsx:1153`. | `CAPABILITY_GAP/BLOCKED`; no Workspace/Shell product change was made in this round. |

## Candidate contract

`GovernanceFeature` accepts the following narrow, read-only projection keyed to
the request id returned by `commands.submit`:

```text
port.creation = {
  requestId,
  accepted,
  ledger,
  observable,
  membership,
  serving,
  channel,
  failed?,
  error?
}
```

Every lifecycle fact is required to be explicitly `true`; `channel` is only
resolved from the directory after `observable` is true, and `ready` requires
all five facts plus a channel projection. A ready result calls
`commands.enterChannel({ channelId, view: 'conversation' })`. If the Shell port
is absent, the button is disabled and the UI reports the contract boundary; no
browser hash is manufactured.

This leaves AD-153 and the separate AD-150–152/155 create contracts unresolved
without judging any capability obsolete. The A–D ledger after the AD-149
migration is **325 PASS / 0 REGRESSION / 40 BLOCKED**.

## Boundary proof

This round changes only `GovernanceFeature.jsx`, the migrated A–D test
`channel-create-modal.test.jsx`, and this A–D evidence report plus the
corresponding ledger/verification references. It does not modify Workspace,
Shell, Feed, Reading, Composer, vendor, package, lockfile, private exports, or
old stores/compatibility APIs. No baseline declaration is deleted, skipped, or
weakened.
