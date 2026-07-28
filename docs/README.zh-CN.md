# Lyra 内部工程文档总览

Audience: Internal
Status: Active
Last verified: 2026-07-28

本目录只面向 Lyra 仓库维护者，英文文档是真源。本页用于帮助中文维护者找到对应资料，
不是另一套需要人工逐字同步的规范。公开用户文档位于 `web/docs`，法律内容位于
`web/site`；Tool-FS、Electron IPC/preload、runtime socket、SQLite/JSON 持久化格式、
内部 Rust/TypeScript 包边界和 Agent ABI 都不得作为公开兼容承诺。

## 文档分组

- [架构总览](architecture/overview.md)：Desktop 主进程/渲染进程、`lyrad`、Agent
  runtime 与宿主能力的组合方式。
- [安全与数据流](architecture/security-data-flow.md)：信任边界、模型上下文、浏览器、
  凭证、位置和外部服务数据流。
- [内部契约](contracts/README.md)：IPC/preload、Tool-FS、runtime socket、持久化和包边界。
- [运维](operations/README.md)：构建测试、发布、第三方许可、隐私审计、服务商登记和
  事件响应。
- [ADR](decisions/README.md)：已接受或提议中的架构决策、替代方案和后续状态。
- [设计规范](design/README.md)：Workbench 组件、样式迁移和视觉验收。
- [自动生成索引](generated/README.md)：模块、IPC 和 Tool-FS 快照。

## 当前必须注意的边界

- Desktop 是 Electron 产品：渲染进程通过受限 preload API 访问主进程；IPC 名称和
  `LyraDesktopApi` 仅是内部契约。
- `lyrad` 通过本机 socket/Windows named pipe 承担 Agent、终端、下载、代码索引等
  运行时路由；协议不是外部 SDK。
- Agent 每个 turn 当前会采集本机身份线索并计算 persona，然后把推导结果加入所选模型
  的上下文。现有 consent 服务不能被文档误写成已经控制这条 runtime 路径。
- 登录管理器会在登录表单提交/点击时捕获账号和密码，密码使用 Electron
  `safeStorage` 在本机加密；MCP headers/env 则保存在本地 JSON，不应误称为钥匙串。
- 搜索建议、模型服务、Skills 来源、更新、语言包、网页访问和公共 Nominatim 都可能
  产生网络请求。Lyra 是“本地优先”，不是“完全离线”。
- UIUX Pack 是用户信任后运行的 Desktop 代码，目前不是安全沙箱；manifest 权限字段
  不能被解释为强制隔离。
- HarmonyOS 工程目前是可构建的 Workbench shell/视觉契约实现，Agent bridge 尚未完整
  接入，也不是对外发布产品。详见 [HarmonyOS shell](architecture/harmonyos-shell.md)。

## 维护命令

在仓库根目录执行：

```sh
node docs/scripts/generate-inventories.mjs --check
node docs/scripts/check-docs.mjs
```

若索引过期，先运行不带 `--check` 的生成命令，再审查生成差异。任何内部契约或数据流
变更都应同时更新对应英文真源。

