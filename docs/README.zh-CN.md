# Lyra 内部工程文档总览

Audience: Internal
Status: Active
Last verified: 2026-07-31

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
- [组件运行时与独立更新](architecture/component-runtime.md)：16 个签名发布单元、
  精确 BOM、版本租约、安全切换与 Core 投影。

## 当前必须注意的边界

- Desktop 是 Electron 产品：渲染进程通过受限 preload API 访问主进程；IPC 名称和
  `LyraDesktopApi` 仅是内部契约。
- `lyrad` 通过本机 socket/Windows named pipe 承担 Agent、终端、下载、代码索引等
  运行时路由；协议不是外部 SDK。
- Persona 默认关闭；用户明确选择开启后，Agent turn 才会采集本机身份线索、计算
  persona，并把推导结果加入所选模型的上下文。
- 登录管理器的自动捕获默认关闭；用户在 Login Manager 明确开启后，才会在支持的
  登录表单提交/点击时捕获账号和密码，密码使用 Electron
  `safeStorage` 在本机加密；MCP headers/env 则保存在本地 JSON，不应误称为钥匙串。
- 模块化 Credentials 列表只读取密码元数据；显示、复制和填充均要求明确的用户操作。
  复制由 Core 解密后直接写入剪贴板，不把密码返回应用包；显示出的值只短暂保存在
  renderer 状态中，切换条目或收到凭证更新事件时清除，也不会写入标签快照。
- 已提交的搜索、模型服务、Skills 来源、更新、语言包和网页访问都可能产生网络请求。
  输入期间的 Google/Wikipedia 建议和公共 Nominatim 已停用。Lyra 是“本地优先”，不是“完全离线”。
- UIUX Pack 是用户信任后运行的 Desktop 代码，目前不是安全沙箱；manifest 权限字段
  不能被解释为强制隔离。
- 第一方应用共享 renderer 是发布隔离而不是安全隔离；第三方应用只能进入隔离
  WebContents/WASI 执行路径，且生产安装入口当前保持关闭。
- 正式打包后的 `active/previous/pending` 指针由 Rust bootstrap 的追加式 registry
  权威维护；Desktop 的 `registry.v1.json` 只是已验证的元数据/防回放投影。直接在
  TypeScript 中修改指针只允许显式开发/测试模式。
- 安装器在用户确认系统级安装后会通过 macOS/Windows/Linux 的系统授权机制提权；
  Desktop 内的“重启并应用”本身不会提权，系统目录更新仍应回到显式提权的安装/修复
  流程。当前也没有 Apple Developer ID 或 Authenticode，Core 自动替换保持关闭。
- 模块化迁移采用功能就绪门禁：独立 bundle 可以先构建、验签和测试，但在功能矩阵
  完整前仍由现有静态 surface 提供用户功能，不能为了“形式上的模块化”制造回归。
  当前仅 Notifications 标为 `complete`，其余 8 个应用仍是 `preview`。Playwright
  已有绑定当前签名 BOM、资源安全点、Runtime 重启和失败恢复的首次获取/修复服务，
  但现有 Browser/Computer Use 实际使用 Electron/CDP 与原生可访问性，并不依赖
  Playwright；仍需首个真实依赖方接入和六目标验证，不能把无调用方的基础链路称为
  发布完成。
- aria2 在真正启动原生任务前会向 Core 取得与绝对路径和组件版本绑定的资源租约，
  直到进程结束且最终任务状态已写入后才释放。Runtime 通信断开本身不视为任务结束，
  遗留租约会阻止资源切换；开发模式也只接受完整 manifest 校验后的仓库 bundle，
  不搜索系统 `PATH`。
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
