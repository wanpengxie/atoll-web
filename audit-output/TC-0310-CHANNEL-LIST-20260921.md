# TC-0310 — B-BR-10 channel.list public-path migration

## Contract

- **Baseline:** `TC-0310`, old `fae8b70:tests/browser/phase-b.spec.js:439`.
- **User capability:** while viewing the ordinary `c0.project` channel, a user can enter `/channels`; the system actor returns the channel directory and the public result includes `c0.public`.
- **Invariant:** the command is submitted on the active channel to the canonical `system` audience (`system.channel.list`); the visible directory is the server result projected by the Workspace timeline, not a client-inferred rail/store snapshot.
- **Current public owner:** Workspace's Composer command port (`/channels` → `system.channel.list`) and the Workspace timeline structured-result projection. No private export, compatibility API, or second store is used.
- **Allowed change:** the dedicated browser contract at `tests/browser/tc0310-channel-list.spec.js` and this report only. No product, mock, vendor, package, or lockfile change.

## Uniqueness

The 1,487-row migration ledger has one retained `TC-0310` row. Its only baseline reference is the absent `fae8b70:tests/browser/phase-b.spec.js:439` path. Before implementation, searches across `audit-output/` (excluding the ledger) and all refs found no `TC-0310`, `B-BR-10`, or equivalent current owner claim. Existing `system.channel.list` unit/mock tests cover protocol/model behavior but not this ordinary-channel Composer-to-Workspace public journey.

## Evidence

Base: `54111bfb7803bfba91d07c7151bfddf492a53afd` (`54111bf`). Independent worktree/branch:

`/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0310-channel-list-54111bf` / `unit-a-d/tc0310-channel-list-54111bf`

The test performs only public user actions and public observables:

1. reset the multi-channel fixture and log in as `root`;
2. select `c0.project` and enter `/channels` in the visible Composer;
3. observe the public submitted frame (`channel_id: c0.project`, `msg_type: system.channel.list`, `audience: ['system']`);
4. open the visible `system.channel.list` structured result and assert `c0.public`.

Results on the independent worktree:

- Chromium focused run: **1/1 passed**.
- Chromium repeat run: **3/3 passed**.
- Related unit/mock/result suites (`composer-command-port`, `mock-governance`, `structured-result-restore`): **3 files, 26/26 passed**.
- `npm run build`: **passed**.

## Result

**PASS — current public owner and user-visible behavior are verified.** This is a test/audit-only migration; no product behavior was changed.
