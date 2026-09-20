# A–D Round 39 — AD-154 exact-clean re-verification

Date: 2026-09-20

## Case record

| Baseline | User capability | Invariant / current public owner | Evidence | Disposition |
|---|---|---|---|---|
| `AD-154` — `channel-create-modal.test.jsx:123` | A failed submit or failed ledger terminal keeps the entered name/purpose, explains failure, permits retry, and never offers entry before a successful convergence. | `WorkspaceRightPanel → GovernanceFeature.ChannelCreateModal` consumes request-keyed `port.creation`; `failed/error` is separate from ready; Shell `enterChannel` is only for a fully ready child. | Exact clean HEAD `15e4470`; `npx vitest run tests/blocked-round35-governance-public-owner.test.jsx --reporter=verbose`: **1 file, 3/3 passed**. The failed-terminal branch at lines 117–155 confirms `创建失败`, exact `名称已存在`, editable draft, enabled `重新创建`, and no `进入新频道`. | **PASS.** The Round 38 red packet is closed by existing owner fix `34f286b`; this round made no product change. |

## Adjacent verification

- AD-153 focused slice: `tests/channel-create-modal.test.jsx` plus the retained
  public-owner evidence, **2/2 passed**.
- The exact-clean ledger correction is **326 PASS / 0 REGRESSION / 39 BLOCKED**;
  the prior 325/1/39 state was the unfixed Round 38 observation.
- No regression packet is open for AD-154. If a later clean candidate reopens
  this contract, the first owner remains `GovernanceFeature.ChannelCreateModal`
  and the same reproduction must be used.
- No source, vendor, package, lockfile, private export, baseline deletion, or
  expected-fail change was made in this round.

