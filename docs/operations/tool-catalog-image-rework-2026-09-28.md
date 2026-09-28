# 工具目录生命周期与图片上下文重构

Audience: Internal
Status: Active
Last verified: 2026-09-28

对应调查：[MiMo Pro 最新会话故障](mimo-tool-schema-loss-2026-09-28.md)。原会话未保存失败调用的原始函数名，因此不能事后断言那个名字是什么；以下缺陷由代码和复现测试确认。

## 验收动作

1. 查看本地、下载或生成的图片：调用 `read_file(path)` 后，下一轮模型请求必须含真正的图像内容，不能靠打开浏览器、File Manager 或 Image Viewer 代替。
2. 搜索并使用软件工具：搜索返回已加载后，普通调用不重查目录；目录暂时失败不会删除已加载记录或成功目录。
3. 模型请求不存在或未加载的工具：阻止执行，返回带原始名字的工具错误，模型可以纠正；不能归类成没有函数名并反复重试整个供应商请求。
4. 真正移除工具、断开 MCP、压缩历史后，工具的可用性和搜索回执仍然一致。

## 参考实现的边界

| 实现 | 阅读的位置 | 做什么、不做什么 |
| --- | --- | --- |
| Codex | `參考/codex/codex-rs/core/src/tools/handlers/view_image.rs` | 读取和校验本地图片，返回图像内容块；不先打开桌面查看器。 |
| ZCode | `參考/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/read-image.ts`、`tool/registry.ts` | Read 准备受限的模型图像；注册表分离注册、注销和查找；拒绝别名冲突覆盖已有工具。 |
| Hermes | `參考/hermes-agent/tools/vision_tools.py` | 原生视觉路径直接返回多模态内容；另有辅助视觉模型路径。本次沿用 Lyra 主模型能力检查，没有引入额外模型路由。 |
| Claude Code | `參考/Claude-Code/src/tools/ToolSearchTool/ToolSearchTool.ts`、`services/mcp/useManageMCPConnections.ts` | 搜索已有工具集合；收到目录变化再更新，失败不会用空集合覆盖成功结果。 |
| OpenCode | `參考/opencode/packages/opencode/src/tool/read.ts`、`mcp/catalog.ts`、`session/llm.ts` | 图片作为附件；目录获取失败与空列表有区别；错误工具名交给工具错误处理，而不是直接终止整个会话。 |

Anthropic 官方要求工具引用存在对应定义。Lyra 在本地完成搜索，选中的完整 schema 直接对模型可见，不再对这些已加载工具重复启用服务端延迟加载；确实采用原生延迟加载的请求只生成仍有定义的引用。[官方工具搜索文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

## 已修改的机制

- [x] 软件目录独立成共享快照：新用户轮或显式 `ToolSearch(refresh=true)` 刷新；普通搜索、schema 组装和执行复用成功快照。并发刷新合并，已有快照的读取不被慢刷新阻塞。
- [x] 刷新失败保留成功目录和错误诊断，成功空列表才清空目录；不同 host 不共享缓存。避免为了取得诊断再请求一次目录。
- [x] 已发现工具名称作为会话记录保留；当前可用性只控制本次请求，不删除发现历史。普通软件调用、MCP 工具执行、技能列表不再被误判为安装目录变化。
- [x] 已加载 schema 在历史压缩后仍直接可见；Anthropic 不再发送已移除定义的工具引用。断开的 MCP 候选会标记为找到但未加载。
- [x] 流式和非流式解析保留完整的未知工具调用，由统一执行入口拒绝并反馈，保留名称、调用 ID 和推理回放。流式函数名按增量拼接。真正缺失函数名仍是协议错误，显示可取得的实际结束原因。
- [x] `read_file` 和图片 `artifact_read` 共用原生图像准备：根据文件内容识别格式、解码校验、约束输入体积和解码内存、限制到 2048 像素长边及 5 MiB 输出，写入受控证据文件后进入现有多模态请求链路。
- [x] GIF/WebP/APNG 明确只展示首帧；需要分析动画时仍可抽取帧或查看源码。模型不支持图片或附件未送达时，给模型返回明确失败，不声称已看图。
- [x] 浏览器检查真实 WebContents 生命周期；意外销毁清理旧实例，导航等待结束后不再读取已销毁对象，也不自动重放导航。

图片查看器仍可供用户主动查看图片；它不再是模型读取本地图片的前置依赖。所有改动均按格式、协议和生命周期处理，没有针对 GitHub 主页、特定图片、MiMo 模型名或游戏网站写分支。

## 验证记录

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| Rust 工具、协议、目录、图片相关回归 | 通过 | 178 项；包含流式与非流式完整模型循环。 |
| 完整模型循环故障注入 | 通过 | 先加载软件工具、正常执行、显式刷新失败、调用错误工具名、再次执行已加载工具、直接读图片、完成；每种传输 7 次预定请求，无额外协议重试；目录只查询 2 次；错误名字没有到达 host，推理字段完整回放，最后请求含图像 data URL。 |
| 浏览器导航生命周期及相邻测试 | 通过 | 14 项，覆盖导航期间销毁、过期实例替换、读取页面身份等。 |
| 隔离真实 Electron 浏览器用例 | 通过 | 79 项；使用独立 profile 和隐藏窗口，没有操作用户的当前浏览器。验证操作机制，不代表真实模型完成游戏的速度。 |
| 提示词快照、契约检查、diff 空白检查 | 通过 | 2 个快照更新；模板版本 63、工具发现契约版本 4。 |
| 桌面 main/preload、lyrad 构建与本地部署 | 通过 | 已构建并原子替换本地 daemon，构建产物与部署产物 SHA256 一致。 |
| 扩大范围的浏览器模拟测试 | 未全通过 | 303 项中 288 通过、15 失败，另有 6 个未处理异常；集中在旧 semantic-tree 模拟环境缺少 insertText、scrollIntoView、removeInsertedCSS 等方法、旧行为预期及菜单语言用例，不能算作通过。 |
| 桌面整体 TypeScript 检查 | 未通过 | 当前 95 个错误；本次新增导航测试无类型错误。涉及 agent-shadow-controller 的两处错误位于未修改的 140、259 行，其他错误跨多个现存模块。 |
| 全工作区结构检查 | 未通过 | 5 处：state.rs、file.rs、web.rs 的既有文件长度基线，以及 index.ts、storage/roots.ts 的存储根目录规则。本次图片处理拆到独立模块，没有继续向 file.rs 堆实现。 |
| 全工作区 clippy | 未通过 | lyra-bootstrap-installer 的 4 个既有 deny 级别问题：status_copy.rs 两个格式化问题、uninstall.rs 和 main.rs 的冗余 clone。 |

主要复验命令：

```sh
cargo test -j2 -p lyra-agent-runtime --lib -- providers::protocol tools::tool_search tools::image_read software_catalog image_delivery_tests model_loop::tool_catalog_revision catalog_and_images model_loop_attaches_lyra_artifact_images_as_vision_input native_tool_surface_dispatches_file_search_shell_render_and_todo
cargo test -j2 -p lyra-agent-runtime --test prompt_snapshots
pnpm --filter @lyra/desktop test src/main/workbench-browser/tests/agent-navigation-lifetime.test.ts src/main/workbench-browser/tests/agent-page-identity.test.ts src/main/workbench-browser/tests/agent-page-read.test.ts
node --import tsx tools/browser/run-visual.mts
```

本地 daemon：`apps/desktop/native/linux-x64/lyrad`；SHA256：`8578cf26577d7c6b796e2ec6af259b316a459e93b43f9d49d3432fec686da1e6`。
扩大范围检查的失败明确保留，不能据此宣称全库已经通过。

## 使用与边界

需要重启 Lyra 才能载入新主进程和 daemon；开发模式热更新 renderer 不会替换它们。没有重启用户当前应用、重跑付费 MiMo 请求、提交或推送代码。

本次完成的是上述可复现机制修复。最终用户验收动作仍是原来的“查看主页这张图片如何实现”：应直接读抽帧图片进入上下文，且目录波动和错误工具名不再令任务崩溃。没有声称所有网站、模型或未来工具变化都已得到验证。
