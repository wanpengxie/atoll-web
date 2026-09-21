# E–H EH06-06 public-owner migration

Baseline: `fae8b70:tests/f6-performance.test.jsx`, case
`文件面板只保留标题栏和阅读区，Markdown 切换放在关闭按钮左侧`.

| Contract field | Evidence |
|---|---|
| User capability | A user opening a Markdown artifact sees a focused file-detail panel with the document area and can choose Preview or Source without a second metadata/action surface. |
| Architectural invariant | `ArtifactPreviewPanel` is the single Files preview surface; its header actions are ordered before the one SidePanel close control, and it does not recreate the deleted legacy metadata/context action owner. |
| Current public owner | `src/ui/features/files/ArtifactPreviewPanel.jsx` through the public `ArtifactPreviewPanel` port and `SidePanel` header. |
| Baseline setup/action/result | Render a ready Markdown artifact with the old `ArtifactContext`; wait for the rendered reading area; inspect header button order `预览`, `源码`, `复制`, `×`, and absence of `.artifact-metadata` / `.artifact-context-actions`. |
| Current result | The same user-visible setup is expressed through the current public panel. The focused case checks heading `阅读区`, exact header order, Preview/Source pressed state, one `.artifact-preview-mode`, and the absence of the deleted legacy surfaces. |
| Disposition | `PROVEN-DIRECT` after the focused Vitest case passes. This is a direct case-level public-owner proof, not a suite-count substitution. |

The worktree changes only `tests/artifact-preview-resolve.test.jsx` and this
audit. No product, vendor, package, lockfile, compatibility API, or second
owner was changed.
