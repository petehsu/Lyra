# GitLab 测试暴露的通用问题：修复与验收（2026-09-27）

对应[原始调查和逐项时间线](gitlab-test-session-2026-09-27.md)。分支为 `research/surface-browser-map`。电脑卡死后已核对，相关源码改动仍在。本次未提交或清理其他工作区改动，也未重新操作真实 GitLab 账户。

## 固定验收动作

真实任务保持不变：在 GitLab 获取仅用于读取仓库的凭证，clone 指定私有项目，成功后删除本次创建的本地 clone。检查同一个任务是否还出现屏外按钮反复点不到、向下滚却不动、靠截图救场、等待已跳过的登录页、明文凭证进入工具记录，以及任务结束后扫描进程仍然运行。

隔离回归对应这些动作：在窗口、内部滚动容器、shadow root、iframe 中点击已映射的屏外按钮；点击被遮挡或禁用的按钮；读取新生成的长凭证并通过 shell 引用使用；页面直接跳到登录后的目标；结束一个尚在运行前台命令的任务。隔离回归通过不等于真实任务最终验收通过。

## 逐项处理

下面划掉的是已修改并有针对性验证的缺陷，不代表所有网页或整轮耗时已经验收。

- [x] ~~原生滚轮方向相反~~：只在 Electron 输入边界转换方向；DOM 位移保持原语义。原生上下滚动回归通过。
- [x] ~~内部容器滚动被误报为没有移动~~：观测指针下真实滚动祖先的位移；必要时回退到可消费该方向的容器，尊重禁止默认滚动与 overscroll 边界。
- [x] ~~地图承诺自动滚到屏外控件，实际只处理窗口~~：对真实目标调用 `scrollIntoView`，逐层暴露 iframe owner，发布操作活动导致布局变化后再次确认。原生窗口、内部容器、shadow root、iframe 回归通过。
- [x] ~~点击失败只给笼统原因，再要求重新取地图~~：保留 disabled、hidden、covered、moving、detached 等原因，分别给出恢复建议。被遮挡的控件保留引用和阻塞状态，实际点击仍受命中检查保护。
- [x] ~~宽泛关键词把具体控件埋在无关结果中~~：名称和稀有关键词优先于常见角色、祖先区域文字；弱匹配仍可分页找回，且不会自动替 agent 选择点击对象。
- [x] ~~新凭证作为普通输入框值进入地图~~：在字段截短前捕获完整敏感值，保存为现有凭据库中的引用；地图、读页面结果和操作回执统一脱敏。存储失败时隐藏值，不伪造保存成功。
- [x] ~~使用安全引用仍可能把凭据回显进 shell 输出~~：增加 `sensitiveEnv`，通过 `LYRA_SECRET_*` 环境变量解析引用；在输出截断和持久化之前处理跨数据块的凭据回显；重叠凭据优先匹配最长值。存储端检查实际保存的权限，不能靠修改引用中的权限字段取得值。
- [x] ~~前台命令超出预测等待后逃离任务生命周期~~：预测超时仍允许在当前任务中完成；任务结束或取消时停止其未退出的前台进程组。明确的后台终端任务保留独立生命周期。
- [x] ~~等待猜测的中间页面，目标已经到达仍等到超时~~：已观测到导航且新目标文档稳定就绪时，以 `matched=false, stopReason=navigationChanged` 返回当前页面。不把猜错的文本条件伪称为成功。
- [x] ~~connect 错误丢失底层原因、继续进行不适用的流恢复~~：保留 DNS/TCP/TLS 等错误链，移除错误中的请求 URL；区分连接建立失败与响应流中断。连接失败仅做有界重试，不转非流式重复同一连接路径。
- [x] ~~反复对未变化的历史文本重新执行 tokenizer~~：按文本 SHA-256 缓存准确 token 数，最多 8,192 项；缓存只保存摘要和计数，内容变化会重新计算。
- [x] ~~每轮浏览器动作都重建软件能力目录~~：仅在发现工具集合变化，或明确执行工具发现、MCP、技能、软件能力操作时刷新；首次地图仍会补齐浏览器操作工具，后续重复地图不再触发相同刷新。
- [x] ~~本地阶段缺少单独计时~~：任务 provider metadata 增加 `localPhases`，分别累计 `protocolCheckpoint`、`toolCatalogRefresh`、`contextAccounting` 的次数、总耗时和最大耗时；计时本身不新增同步磁盘写入或 UI 事件。
- [ ] **真实 GitLab 任务耗时与纯非视觉结果**：需加载新构建后重复同一任务。原会话 55 次模型请求占约 765 秒，不能把某个本地优化等同于整轮达到 30 秒。
- [ ] **原会话其余 198.986 秒的完整归因、首页首次地图 11.850 秒**：旧日志没有足够的阶段证据；不把它们全部归因于 tokenizer、SQLite 或 VPN。下轮据新增计时及实际工具耗时继续判断。
- [ ] **历史凭证暴露**：本次修改不会撤销旧 token，也不会抹掉已存在的会话历史；建议撤销原测试 token。未擅自删除历史记录。

## 性能证据及边界

`crates/lyra-agent-reader/examples/token-count-benchmark.rs` 使用 80 条合成浏览器文本消息，共 104,400 token。排除 tokenizer 单例初始化后，原版三次计数分别为 587.083、587.958、586.581 毫秒。新版本首次填充缓存为 783.353 毫秒，重复计数为 21.227、21.109 毫秒；结果 token 数完全相同。缓存命中时约快 28 倍，冷启动没有这种收益。

原生连续三次“输入并发送，等待新回复”回归只获取一次初始地图，合计约 3.6 秒，每次完成识别约 200 毫秒。这是固定测试页面、无模型推理的工具回归，不是网站或模型端到端性能承诺。

## 参考产品的工作边界

- `參考/ZCode/packages/desktop/src/main/browserView/browserCommandScripts.ts`：针对已经确定的真实元素滚到可见区域后取位置；不会用反复截图代替元素暴露。
- `參考/hermes-agent/tools/browser_tool.py`：在浏览器结果进入模型前清洗字段；不会只靠最终回答隐藏凭据。
- `參考/opencode/packages/core/src/tool/bash.ts`：以有归属和期限的进程执行为边界；没有把一次前台等待结束等同于允许遗留无归属的后台工作。

实现依据还包括 [Playwright 的 actionability](https://playwright.dev/docs/actionability)、[scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)、[Electron MouseWheelInputEvent](https://www.electronjs.org/docs/latest/api/structures/mouse-wheel-input-event)、[reqwest Error](https://docs.rs/reqwest/latest/reqwest/struct.Error.html) 和 [Tokio Child](https://docs.rs/tokio/latest/tokio/process/struct.Child.html)。Electron 正负号结论由本机原生事件复现实证确认，不能仅凭字段名推断。

## 验证记录

- 原生 Electron：21 项通过，包含滚动、目标暴露、遮挡防误点、完整只读凭证捕获、连续发送与回复识别。
- Chromium 非视觉：87 项通过。
- 集中 TypeScript 单测：原 9 个文件 67 项通过；新增重叠凭据回归后，凭据相关 2 个文件 11 项通过，合并覆盖 68 项。
- Rust：token 计数 8 项、连接恢复 2 项、目录刷新 2 项、本地阶段计时 1 项、shell 脱敏 3 项、安全引用子进程集成 1 项、任务结束回收进程 1 项通过。
- TypeScript 全量检查仍有 94 个既有错误；本轮新增的类型错误已修正。没有把全量检查标为通过。
- 结构检查剩余 5 个既有问题：`state.rs`、`tools/file.rs`、`tools/web.rs` 超出行数基线，以及 `main/index.ts`、`storage/roots.ts` 的存储路径边界规则。本轮 `protocol_io.rs` 通过拆出连接恢复测试恢复到限制内。
- 工作区 Clippy 被 `lyra-bootstrap-installer` 的既有错误阻断；针对 `lyra-agent-runtime` 和 `lyra-agent-reader` 的全部 target Clippy 已通过（仍有既有警告），新加代码的可合并条件警告已修正。广泛 shell 过滤测试为 52 通过、3 失败：旧权限交互预期、旧输出截断预期，以及沙箱禁止本地监听。它们不是本轮针对性回归通过的依据。

## 安全引用覆盖范围

检测依据是通用凭证格式、密码/密钥/令牌字段语义，以及已经通过引用解析的已知值，没有 GitLab 域名专用分支。无语义且格式未知的任意随机文本、图片中的密钥无法据此承诺全部识别。shell 脱敏处理引用绑定值的原文回显；故意编码、变形或另写外部文件不属于通用输出脱敏能自动消除的内容。

使用 git 时通过凭据 helper 读取环境变量，不能把环境变量再展开为含凭据的 clone URL。提示词已明确这一点，也要求清理限于本任务创建的已知路径、前缀匹配不等于完整秘密、未完成扫描不能证明没有残留。

## 构建与加载

主进程和 preload 已重新构建；`cargo build --offline -p lyrad -j 2` 成功。新 `lyrad` 已以原子替换写入 `apps/desktop/native/linux-x64/lyrad`，源文件与目标文件 SHA-256 一致。`cargo fmt --all --check` 和本轮相关文件的 `git diff --check` 通过。临时主进程构建配置已移除。

需要完整重启开发版 Lyra 后重复固定任务，正在运行的旧进程不会因文件替换自动加载新代码。没有自动终止用户当前会话，也没有提交这些工作区改动。
