# Shell reservation — TC0336 / E-BR-08 + E-BR-10 file resource journey

## Atomic claim

- **Canonical baseline key:** `TC0336` (`E-BR-08/E-BR-10`)
- **Baseline identity:** `fae8b70:tests/browser/phase-e.spec.js:207-226`
- **Reservation state:** `RESERVED — not PASS, not credit, not a product fix`
- **Reservation base:** `e532a9884953c015b33b3c5f6b3fb38f149d6d66`
- **Reservation branch/worktree:** `codex/shell-tc0336-e532a98` / `/tmp/atoll-web-shell-tc0336-e532a98`

This is the atomic reservation for the next Shell/Files baseline after TC0335.
It intentionally adds no browser successor and changes no product source. A
later packet may only be credited after the public path is run from this exact
base and reviewed.

## User contract and current owner

The old public ability is the channel resource journey:

1. open `频道操作 → 高级资源工具 → 文件`;
2. choose the channel's `local-device` target and upload the supplied file;
3. observe `上传完成` in the public resource surface;
4. attach the uploaded resource to the Composer draft;
5. send the message and observe the attachment card; and
6. download from that card and receive the original filename without failure.

The current public owner is the existing `WorkspaceApp` Files port backed by
`useAttachmentTransactions`, rendered by `FilesFeature` and consumed by the
Composer attachment port. The resource operation, upload ticket, attachment
draft, and download ticket all remain in that owner graph. This reservation does
not add a resource store, direct wire call, compatibility parser, or a second
Files/Composer owner.

## Uniqueness checks

- TC0335 is already the distinct KV CRUD successor (`E-BR-07`) and does not
  cover file upload, attachment, or download.
- TC0337 is the separate expired-ticket retry contract and is already present
  in `tests/files-ticket-recovery.test.jsx`; it does not cover this successful
  upload → attach → send → download journey.
- No tracked TC0336 successor, reservation, branch, or worktree was found in
  the current refs before this reservation. TC0315 and TC0317 are Waiting
  contracts and are explicitly outside this claim.

## Scope after reservation

The follow-up is limited to a public browser successor and its audit, unless a
stable red first breakpoint proves a product gap in the existing Files or
attachment owner. It must not change backend/protocol/vendor/package files,
invent a success receipt, weaken selectors/assertions, or introduce a second
store/route/owner.

