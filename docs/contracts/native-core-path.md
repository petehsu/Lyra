# Native core path

Audience: Internal
Status: Active
Last verified: 2026-09-20

Files disk IO is `lyra-files-core` behind `lyrad` `files.*`. Image / docs /
accessibility stay Rust `*-core` with Electron N-API adapters. Do not add
`FilesApi.getPathForFile(file: File)` back.

清单由 `tools/verify-native-core.ts` 的 `STABLE_CORE_PATHS` 与 files daemon
检查看守。改 crate 配对先改那一处。

## 稳定 core

| 域 | Core crate | Electron 适配 |
| --- | --- | --- |
| Files | `lyra-files-core` | `lyrad` `files.*` ← `apps/desktop/src/main/files/service.ts` via `runtime-client` |
| Image | `lyra-image-core` | `lyra-image-napi` ← `apps/desktop/src/main/image-viewer/native-loader.ts` |
| Docs | `lyra-docs-core` | `lyra-docs-napi` ← `apps/desktop/src/main/documents/native-loader.ts` |
| Accessibility / Computer Use | `lyra-computer-use-core` | `lyra-accessibility-napi` ← `apps/desktop/src/main/accessibility/native-loader.ts` |

Core crate 不得依赖 `napi` / `napi-derive`，也不得做成 `cdylib`。
`lyrad` 不得依赖任何 `*-napi` crate。Terminal / LSP / download / files 已经走 daemon。

## Core 已经能接的操作

- Files：`files.read_directory` / subscribe / patches 事件、trash、create、favorites、recent、stat、read/write text、search、mount/eject、home 盘点
- Image：`ImageKernel::{open_image, read_tile, close_session}`
- Docs：`probe_document` / `read_document_text` / `search_document_text`
- Computer Use：`map_json` / `find_json` / `act_json` / `diff_json` / `explain_json` / `list_apps_json` / `observe_json` / `focus_json`

## 仍留在 Electron 壳

- `FilesApi.selectAttachments` / `selectDirectories`（系统文件对话框，属 IPC 腰）
