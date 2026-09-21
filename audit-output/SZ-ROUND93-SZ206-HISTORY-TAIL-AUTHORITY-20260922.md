# SZ-206 history tail authority

Date: 2026-09-22

Base: `28bc0b832414f2a7fcc4df4351a9b296ffe49500`

## Contract

| item | decision |
| --- | --- |
| User capability | A readable intermediate history page must not make the current presentation look caught up until its coverage reaches the authoritative head. |
| Invariant | The public Presentation authority receipt is absent while coverage ends at an intermediate page (`20–40`, then `20–60` for head `100`), and appears only after coverage reaches the candidate-to-head fence (`20–100`). |
| Public owner | `useConversationProjection.viewport.presentationAuthority`; evidence is the public receipt plus `projection.presentation.rows`. |
| Scope boundary | No private helper import/export, private store field, old scheduler, compatibility path, second owner, product source, vendor, package, or lockfile change. |

## Evidence

`tests/sz206-history-tail-authority-public-owner.test.jsx` uses one public projection owner and three status publications:

1. candidate `middle` at sequence 40 with coverage `20–40` → no authority receipt;
2. candidate `middle-2` at sequence 60 with coverage `20–60` → still no receipt;
3. candidate `authoritative` at sequence 20 with coverage `20–100` → frozen public receipt `{ epoch, viewID, sourceRevision: 100, candidateID }`.

This migrates the old intermediate-tail behavior to the current public `Presentation`/Reading owner; it does not import the retired `currentEntryAuthority` helper.

## Result

Focused Vitest: **PASS** (1 file, 1 test).

The current public owner satisfies the contract. No product change or regression hand-off is required.
