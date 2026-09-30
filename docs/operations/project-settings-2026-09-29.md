# 项目设置与全局能力管理

Audience: Internal
Status: Implemented; owner click-through pending
Last verified: 2026-09-29

## 最终范围

设置新增“项目”，与输入框共用持久化项目注册表。选择目录后即登记，无需发送消息；
首次从全部会话 SQLite 元数据回填，包括归档会话，不读取聊天正文，也不经过最近
500 条会话接口。目录规范化去重、按使用时间排序，失效目录仍显示为不可用。

项目详情只有 MCP 和 Skill 两个页签，默认 MCP。提供搜索、开关和“恢复全局默认”，
安装、配置编辑、卸载继续使用全局页面。导入页已移除项目选择和清除入口。

按用户最后的约束，本次不提供旧版兼容：删除项目级注册表迁移、旧目录兼容读取、
旧请求字段适配、旧导入指纹匹配。不会自动搬迁旧版项目级安装，也不会删除旧文件。
历史会话回填是项目列表功能；导入其他软件的项目配置是显式导入功能，二者继续保留。

## 状态与存储

- 项目身份、目录、别名、使用时间、稀疏能力覆盖和导入初始化标记写入应用数据目录
  `projects/registry.v1.json`。不写项目仓库。
- MCP 配置和默认开关存于全局 MCP 注册表。连接健康状态与启用设置分开。
- Skill 默认开关存于全局 Skill 目录 `enabled.v1.json`，采用同步原子写入；不经过
  聊天状态的延迟保存队列，也不在聊天状态中保存另一份开关。
- 项目覆盖使用 true / false / null；null 删除覆盖，随后跟随全局。Home 使用全局。
- 前端收到服务端保存结果后更新开关，失败显示错误并重新读取实际状态。

项目关闭不会断开共享 MCP。提示词、动态能力目录、ToolSearch、普通调用和动态调用
均使用实际会话所属项目，调用前再检查设置。模型参数不能替换项目身份。能力目录按
当前项目实时生成，不共用另一项目的动态能力缓存。断开但允许使用的 MCP 保持原有
“可发现、待连接”语义，不将连接失败解释成用户禁用。

## 全局导入

显式检测扫描用户配置及项目注册表内的全部已知目录；单个目录无效作为诊断返回。
项目设置页不扫描其他软件、不连接 MCP、不联网刷新 Skill 商店。

候选项保留软件、源路径和源项目。目标统一全局；内容不同的同名条目使用确定性 ID，
已有目标被用户编辑时保留冲突保护。新项目来源条目全局默认关闭，仅给原项目初始化
来源启用状态；初始化标记保证重复同步不会覆盖用户后来关闭或恢复默认的选择。
MCP 导入保留凭据保护及源目录相对路径语义，不在导入完成时自动连接。

Skill 目录的安装、卸载、商店刷新在提交阶段串行合并。联网刷新结束后重新读取目录，
避免旧快照覆盖同时安装的新条目。已有配置中的凭据引用在编辑和脱敏展示时保留。

## 参考依据

参考的工作边界是：启用选择不通过连接状态推断，项目开关不改写共享配置文件。
[VS Code 官方 MCP 文档](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
将全局/工作区启用选择与 `mcp.json` 配置区分保存。本地
`參考/vscode/src/vs/workbench/contrib/mcp/browser/mcpWorkbenchService.ts` 的
`getRuntimeStatus` 也分别处理全局和工作区禁用状态。Lyra 使用用户确认的
“项目明确设置优先，否则全局默认”规则，不照搬 VS Code 的全部配置层级。

本地 `參考/ZCode/packages/services/src/setting/settingsWriteQueue.ts` 在进入提交阶段
后等待真实写入结束，不提前报成功。Lyra 沿用自己的原子写入机制，把开关确认放在
落盘之后。此前拖拽、主题、Markdown 表格和引用修复保持原样，见相邻 GUI 调查记录。

## 验证

使用临时数据目录，不修改用户真实项目或全局配置。后端覆盖：503 条元数据回填、
归档/Home 过滤、草稿与失效目录、目录去重、会话删除后项目保留、三态开关隔离、
Home 默认、模型伪造项目参数、普通和动态旧能力调用拒绝、共享 MCP 状态保持、
Skill 提示词过滤、原子写入失败、同名导入、重复同步、用户编辑冲突和并发 Skill 安装。

桌面浏览器回归直接使用实际组件与 Rust 后端，重复以下操作：

1. 输入框选择项目，不发送消息；设置列表立即出现。
2. 进入项目，默认 MCP；开启一个全局关闭的 MCP，另一项目保持关闭。
3. 键盘切换到 Skill，关闭条目；检查浅色和深色画面。
4. 重启后端，确认覆盖保留；恢复全局默认，确认开关跟随全局。
5. 移除临时目录，确认项目仍显示为不可用；确认关闭的 MCP 调用被拒绝。

这套夹具验证组件、IPC 语义和真实持久化，不代替原生目录选择器、真实模型供应商及
用户实际 MCP 服务的完整桌面验收。请在应用中重复同一条操作路径。

## 项目页面接口漏注册修复

用户实际打开“设置 → 项目”时出现 `unknown agent runtime method: agent.projects.list`。
对正在运行的桌面 daemon 发起相同请求，确认返回 `METHOD_NOT_FOUND`。问题在公共
`AgentRuntimeServices::handle_agent_request`：底层项目实现和桌面 IPC 已存在，但公共
入口漏注册 `agent.projects.list/register/settings/setOverride` 和 `agent.mcp.setEnabled`。

此次补齐这五个显式路由；未注册方法仍返回错误，没有通配转发、旧版适配或新存储路径。
工作边界参考本地 OpenCode 的 `ProjectApi`、`projectHandlers` 和 HTTP API layer：
项目服务不绕过公开入口直接提供给界面；接口必须经过路由注册。
[OpenCode Server 文档](https://opencode.ai/docs/server/) 同样将项目查询列为公开 API。

此前浏览器夹具直接调用 `LyraAgentBackend::call_agent_method`，绕过了出错的公共入口，
因此此前的“四项通过”不能证明桌面路由完整。已改为通过 `AgentRuntimeServices` 调用，
并增加全局 MCP 开关往返验证。新增路由回归在修复前复现相同错误，修复后相关六项通过；
同时验证 true/false/null 参数保持原样，以及未注册方法继续拒绝。桌面 IPC 的 93 个
方法名与公共 service 声明核对，无遗漏。

修复后浏览器完整重建，并通过五项操作回归（包括新增的全局 MCP 开关验证）；另启
临时数据目录的真实 `lyrad`，通过 socket 验证项目列表、登记、详情、三态覆盖和全局
MCP 开关，三组检查通过。浅色/深色截图已更新为经过公共入口的运行结果。
`cargo fmt --all -- --check` 和运行时全部 targets 的 Clippy 通过；结构检查仍为下文
相同五项既有问题。重新编译并暂存了桌面原生资源，确认构建产物与暂存 `lyrad` 的
SHA256 一致。桌面重新启动后加载新版；用户实际点击验收仍待重复。
本次验证记录：[project-routing-2026-09-29.json](assets/project-routing-2026-09-29.json)。

## 检查记录

- 前端 68 项通过（8 个文件），后端相关 60 项通过：项目 3、导入 10、MCP 7、
  Skill 11、ToolSearch 18、Tool-FS 7、状态持久化 4。
- 实际 React 组件 + Rust 后端浏览器流程 4 项通过，无页面错误；包括重启后的设置。
  自动化命令为 `pnpm --filter @lyra/desktop test:project-settings`。
- 桌面 TypeScript：当前 95 条诊断，HEAD 基线 95 条；按文件、错误码及信息比较无新增。
- 语言包清单与公开契约检查通过（1525 个键）；`git diff --check` 通过。
- `pnpm lint:structure` 仍报告 5 个既有问题：state.rs 超过 2000 行（本次从 2038
  减至 2031）、tools/file.rs 和 tools/web.rs 超限，以及 main/index.ts 和
  main/storage/roots.ts 的存储根路径规则。
- 运行时 crate 的 Clippy（全部 targets）通过，保留仓库已有警告。
- 全工作区 Clippy 被既有 lyra-bootstrap-installer 的 4 个错误阻挡：status_copy.rs
  两个格式化参数问题、uninstall.rs 两个冗余 clone。本次未修改这些文件。
- 全工作区格式检查仍有大量既有差异；本次新 Rust 文件与改动区域已格式化，
  没有全仓重排其他文件。
- 额外执行的 `model_request_injects_lyra_identity_and_tools` 仍有一条陈旧断言：
  期望列表漏了 design_reference / design_extract_reference / design_quality /
  browser_navigate / browser_read / browser_map 六项。核对 HEAD 的
  `eager_model_tools_without_search`，这六项在本次修改前已存在；本次没有改动
  该函数，也没有改写断言来掩盖失败。核心 ToolSearch 的 18 项回归通过。

结果数据：[project-settings-2026-09-29.json](assets/project-settings-2026-09-29.json)。
截图：[浅色](assets/projects-light-2026-09-29.png)、[深色](assets/projects-dark-2026-09-29.png)。
