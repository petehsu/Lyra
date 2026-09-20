# Native core path

Audience: Internal
Status: Active
Last verified: 2026-09-19

Files / image / docs / accessibility 的稳定实现是 Rust `*-core`，不是 Node NAPI。
Electron 可以继续 `dlopen` `*-napi`。
不要把这条稳定面做成 `lyrad` 新路由；也不要把 `FilesApi.getPathForFile(file: File)` 加回来。

清单由 `tools/verify-native-core.ts` 的 `STABLE_CORE_PATHS` 看守。改 crate 配对先改那一处。

## 稳定 core

| 域 | Core crate | Electron 适配（NAPI，非稳定路径） |
| --- | --- | --- |
| Files | `lyra-files-core` | `lyra-files-napi` ← `apps/desktop/src/main/files/native-loader.ts` |
| Image | `lyra-image-core` | `lyra-image-napi` ← `apps/desktop/src/main/image-viewer/native-loader.ts` |
| Docs | `lyra-docs-core` | `lyra-docs-napi` ← `apps/desktop/src/main/documents/native-loader.ts` |
| Accessibility / Computer Use | `lyra-computer-use-core` | `lyra-accessibility-napi` ← `apps/desktop/src/main/accessibility/native-loader.ts` |

Core crate 不得依赖 `napi` / `napi-derive`，也不得做成 `cdylib`。
`lyrad` 不得依赖任何 `*-napi` crate。Terminal / LSP / download 已经走 daemon，不在本表。

## Core 已经能接的操作

- Files：`read_directory_snapshot`、`DirectoryService` 订阅、`read_text_file` / `write_text_file` / `stat_file`、`read_favorites_from_storage` / `read_recent_from_storage`、`probe_workbench_path`
- Image：`ImageKernel::{open_image, read_tile, close_session}`
- Docs：`probe_document` / `read_document_text` / `search_document_text`
- Computer Use：`map_json` / `find_json` / `act_json` / `diff_json` / `explain_json` / `list_apps_json` / `observe_json` / `focus_json`

## 仍留在 Electron 适配里

这些现在还在 `*-napi` 或 Electron dialog，不是本项要搬进 core 的稳定面：

- Files：trash / mount / eject / volume 与 home 主机盘点（`dirs` / `sysinfo` / `trash`）
- `FilesApi.selectAttachments` / `selectDirectories`（系统文件对话框，属壳）

以后若要把这些能力收进 core，先把逻辑提进对应 crate，再让 napi 变薄。
