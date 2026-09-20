# S–Z round 23 owner re-verification

Date: 2026-09-20

This round covers twenty non-green contracts without repeating a closed case: the next
sixteen ledger rows SZ-193–SZ-208 and four carry-forward V-OBS packets. The V-OBS rows
are not re-counted as green or as new product work; they are split into their individual
public-observable contracts so the Reading owner receives four independent reproductions.
No Reading/Vendor product file is changed here.

## V-OBS public-observable regression package

`VendorListExecutor` remains the public DOM-observation owner. The observable is the
`reading-observation` fact sent through `reportDomEvidence` at
`src/ui/timeline/VendorListExecutor.jsx:237-265`; settlement is emitted by the
position-restore fence at `:562-591`. Each packet below has one field-level contract,
one user capability, and one direct assertion. All four are still real REDs in the
existing public suite; none is hidden with a skip or an expected-failure marker.

| packet | user capability / invariant | owner observable and direct evidence | current result |
| --- | --- | --- | --- |
| V-OBS-01 / bookmark identity | A user-settled tail observation must preserve the semantic bookmark's message and block identity together. | `VendorListExecutor` `reading-observation.bookmark`; `tests/reading-observation-settle.test.jsx:184`. | **RED**: source/user, settled, and tail are correct, but actual bookmark has `messageID:'tail'` without required `blockID:'block:tail'`. |
| V-OBS-02 / selection authority | Pointer selection/autoscroll must leave Reading in browsing authority and publish a settled user observation at the tail. | `reading-observation.source` and `.settled`; `tests/reading-observation-settle.test.jsx:215`. | **RED**: expected `source=user, settled=true`; actual `source=layout, settled=false` (tail is true). |
| V-OBS-03 / layout non-authority | An input-free layout arrival cannot claim authority; its settled sample must be the non-user settled observation. | `reading-observation.source` and `.settled`; `tests/reading-observation-settle.test.jsx:231`. | **RED**: expected `source=settled, settled=true`; actual `source=layout, settled=false` (tail is true). |
| V-OBS-04 / epoch fence | If the Reading input epoch advances before `scrollend`, the pending user authority must be rejected and the settled fallback must be published. | `reading-observation.inputEpoch/source/settled`; `tests/reading-observation-settle.test.jsx:249`. | **RED**: expected `source=settled, settled=true`; actual `source=user, settled=true` (tail is true). |

These are regression hand-offs to the existing Reading/Vendor owner. The shared worktree
contains dirty Reading/Vendor files, so this packet intentionally changes neither those
files nor the existing direct test.

## Sixteen retained ledger OPEN rows

The current public owners expose adjacent generation, admission, reservoir, live-arrival,
or DOM facts, but none is a one-to-one public successor proving the complete original
capability. Every row therefore remains **OPEN** rather than being declared obsolete or
green.

| case | user capability / invariant | current public owner check | disposition |
| --- | --- | --- | --- |
| SZ-193 | If a reservoir arrives before the old EOF settles, retain one successor for the same obligation and never cache the late EOF as current. | `channel-feed-runtime` generation/EOF/reservoir owner; no reservoir-before-settle successor case. | **OPEN — hand off** |
| SZ-194 | New supply must not inherit an old attempt's anticipatory failure; its successor still executes. | `history-presentation-admission` and `useHistoryConsumer` attempt ownership; no failure-to-successor public case. | **OPEN — hand off** |
| SZ-195 | After blocking admission, an anticipatory underfill returns to the DOM owner for revalidation instead of directly fetching. | History admission plus `VendorListExecutor` DOM-budget boundary; no admission-settle handback case. | **OPEN — hand off** |
| SZ-196 | If admission rejects after underfill is satisfied, the same DOM debt is returned and the next attempt opens. | Admission rejection and DOM owner facts exist separately; no same-debt successor case. | **OPEN — hand off** |
| SZ-197 | A zero-row supply settle commits the first live batch before continuing queued interactive demand. | Feed live-admission and history-demand owners; no zero-row commit-before-queue case. | **OPEN — hand off** |
| SZ-198 | A stale activation/generation live admission cannot block the current history request. | `channel-feed-runtime` generation and live-admission fences; no cross-generation blocking case. | **OPEN — hand off** |
| SZ-199 | Sparse-filter top boundaries derive only from current-generation authoritative exhaustion. | Feed generation/exhaustion and filter projection owners; no sparse-boundary authority case. | **OPEN — hand off** |
| SZ-200 | Cold entry exits materializing only after Virtuoso reports the first public range for the current activation. | `VendorListExecutor` range/DOM evidence and `ConversationSurface` materializing state; no first-range activation case. | **OPEN — hand off** |
| SZ-201 | If the cold-entry range callback is missing, current visible DOM evidence still converges materializing. | `VendorListExecutor` visible-row observation and Surface status; no missing-range fallback case. | **OPEN — hand off** |
| SZ-202 | A missing bookmark continues recovery supply, while already readable rows do not expose blocking initialization. | History admission bookmark recovery and Surface readable projection; no combined missing-bookmark/readable-rows case. | **OPEN — hand off** |
| SZ-203 | Authoritative known-zero installs an empty projection without showing a recovery prompt in the same frame. | Feed known-zero projection and Surface status owner; no same-frame empty-vs-recovery case. | **OPEN — hand off** |
| SZ-204 | Only stable live identities after the current activation accumulate as new dynamic entries. | `live-arrivals` activation/high-water owner; no post-activation identity boundary case. | **OPEN — hand off** |
| SZ-205 | An overflowed live batch is consumed exactly once and identities beyond 256 are de-duplicated. | Live-arrivals batch and Feed identity ledger; no overflow/exact-consumption public case. | **OPEN — hand off** |
| SZ-206 | Intermediate history batch tails are not signed until coverage reaches the authoritative head. | History presentation/admission coverage facts; no intermediate-tail signature case. | **OPEN — hand off** |
| SZ-207 | A local echo inherits current-entry role only after a current durable physical tail exists. | Feed physical-tail and submission echo owners; no durable-tail-before-echo case. | **OPEN — hand off** |
| SZ-208 | Reaching the installed tail acknowledges the scope's complete installed backlog, not only viewport-visible rows. | Feed high-water/read receipt and Surface tail observation owners; no whole-backlog receipt case. | **OPEN — hand off** |

## Verification

Focused public-observable reproduction:

```text
npx vitest run tests/reading-observation-settle.test.jsx --reporter=dot
```

Result: **1 file failed; 4 tests failed.** Failures are exactly V-OBS-01 through
V-OBS-04, with no extra failure masked by filtering. This is a product regression
signal only; no test was edited in this round.

Only this audit report is added. No Reading/Vendor source, package, lockfile, vendor
dependency, private export, compatibility layer, or old test was modified.
