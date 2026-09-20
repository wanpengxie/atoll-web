# S–Z round 24 clean-ee52 owner verification

Date: 2026-09-20

The verification baseline is clean commit `ee52ee2` (`fix(reading): make composer send
an explicit tail intent`). This round covers twenty non-green contracts: the four
V-OBS-01..04 settled-observable regressions and the next sixteen ledger OPEN rows
SZ-209–SZ-222, SZ-225, and SZ-231. Green rows SZ-223, SZ-224, and SZ-226–SZ-230 are
not counted again.

No Reading source or test was changed. The V-OBS results below are clean-baseline
evidence, not a product fix.

## Clean-ee52 V-OBS results

`VendorListExecutor` is the public observation owner. Its `reading-observation` fact is
published through `reportDomEvidence` in `src/ui/timeline/VendorListExecutor.jsx:237-265`.
The direct public suite remains the observable regression boundary.

| packet | user capability / invariant | direct public observable | clean-ee52 result |
| --- | --- | --- | --- |
| V-OBS-01 | A settled user-owned tail bookmark preserves both message and block identity. | `tests/reading-observation-settle.test.jsx:184` expects `source=user`, `settled=true`, `atTail=true`, bookmark `{messageID:'tail', blockID:'block:tail'}`. | **RED**: source/settled/tail pass, but `blockID` is absent from the actual bookmark. |
| V-OBS-02 | Selection autoscroll cannot acquire following authority; the settled tail sample remains user-owned and Reading stays browsing. | `tests/reading-observation-settle.test.jsx:215` expects `source=user`, `settled=true`, `atTail=true`. | **RED**: actual is `source=layout`, `settled=false`, `atTail=true`. |
| V-OBS-03 | Input-free layout arrival is non-authoritative; only the settled sample can be presented as the tail observation. | `tests/reading-observation-settle.test.jsx:231` expects `source=settled`, `settled=true`, `atTail=true`. | **RED**: actual is `source=layout`, `settled=false`, `atTail=true`. |
| V-OBS-04 | An input-epoch advance invalidates pending user authority before `scrollend`; the fallback is non-user settled evidence. | `tests/reading-observation-settle.test.jsx:249` expects `source=settled`, `settled=true`, `atTail=true`. | **RED**: actual remains `source=user`, `settled=true`, `atTail=true`. |

These are four independent red contracts on the same public observable; the clean
baseline did not make any of them green. They remain hand-offs to the dirty
Reading/Vendor owner and were not masked with skips or expected-failure annotations.

## Sixteen retained OPEN contracts

The current public owners expose related tail, high-water, projection, measurement, or
incremental-index facts, but no one-to-one public successor proves each complete
capability. Every case remains **OPEN — hand off**.

| case | user capability / invariant | current public owner check | disposition |
| --- | --- | --- | --- |
| SZ-209 | Jump-to-latest clears nothing until the physical tail is actually reached. | Feed tail intent/high-water and `VendorListExecutor` tail observation; no intent-vs-presence case. | **OPEN — hand off** |
| SZ-210 | A tail receipt never sweeps rows above the observed installed high-water. | Feed receipt/high-water owner; no above-high-water negative case. | **OPEN — hand off** |
| SZ-211 | A staged arrival above the reached tail stays pending instead of being acknowledged by that tail. | Live-arrivals staging and Feed receipt owner; no staged-above-tail case. | **OPEN — hand off** |
| SZ-212 | Browsing away from the tail acknowledges individually seen rows while retaining the rest. | ReadingSession observation and Feed per-identity receipt owner; no selective browsing acknowledgement case. | **OPEN — hand off** |
| SZ-213 | A filtered tail acknowledges only identities installed by its projection, never the physical cursor. | Conversation projection plus Feed filtered receipt owner; no filtered-tail/physical-cursor case. | **OPEN — hand off** |
| SZ-214 | An unfiltered tail advances the physical cursor to installed high-water even when the row is above the viewport. | Feed high-water and `ConversationSurface` tail receipt owner; no above-viewport receipt case. | **OPEN — hand off** |
| SZ-215 | `installedTailReadRows` is bounded by installed high-water and excludes local echo rows. | Feed read-row selector and submission echo owner; no bounded-selector public case. | **OPEN — hand off** |
| SZ-216 | At a visible bottom, viewport count derives to zero without changing receipt truth. | Surface viewport counter and Feed receipt owner; no count-vs-receipt separation case. | **OPEN — hand off** |
| SZ-217 | Jump-to-latest changes intent but clears nothing before physical presence at tail. | Tail intent and DOM observation owners; no pre-arrival negative case. | **OPEN — hand off** |
| SZ-218 | Only real presence suppresses fallback; browsing, hidden Surface, and hidden page do not. | Surface visibility/page visibility and Feed fallback owner; no three-gate negative case. | **OPEN — hand off** |
| SZ-219 | Page invisibility disables fallback and foreground immediately restores it. | Surface/page visibility lifecycle owner; no background-to-foreground fallback case. | **OPEN — hand off** |
| SZ-220 | A committed presentation choice stays on its committed channel without taking Reading control. | Timeline presentation authority and ReadingSession control owners; no committed-channel composition case. | **OPEN — hand off** |
| SZ-221 | Per-row measurement signature changes with target authority or roster kind even when row data is unchanged. | Timeline row measurement owner; no authority/roster-only signature case. | **OPEN — hand off** |
| SZ-222 | An `agent.select` row keys by rendered describe labels, not only capability-word names. | Timeline row renderer/measurement owner; no rendered-label key case. | **OPEN — hand off** |
| SZ-225 | Repeated appends to one state object use the incremental index path rather than rebuilding from scratch. | `selectTimelineItems` / conversation-presentation scope index; no same-state append proof. | **OPEN — hand off** |
| SZ-231 | After baseline, the incremental index consumes only new rows and does not traverse the whole rows map every frame. | Same public scope/index owner; no post-baseline work-boundary proof. | **OPEN — hand off** |

## Verification

The clean-baseline command was:

```text
git status --short --untracked-files=no
npx vitest run tests/reading-observation-settle.test.jsx --reporter=dot
```

`git status` was clean for tracked files at `ee52ee2`. The focused suite reported **1
file failed; 4 tests failed**, exactly V-OBS-01 through V-OBS-04. No additional test was
run or changed to hide the four REDs. This report is the only round-24 artifact.
