# 浏览器文件选择与非视觉上传修复（2026-09-27）

## 用户要重复的动作

1. 用户在网页点附件按钮：应出现系统文件选择窗口。
2. Agent 按任务指定，把明确的本地文件添加到网页：不打开系统窗口，网页得到真实文件。
3. 上传完成仍由网页自己的附件、进度或错误状态证明；选入文件不等于发送邮件，也不自动点击发送。

本轮用户已授权实现附件能力。测试只使用隔离配置、临时文件和本机测试网页，没有向 Gmail 或其他外部网站发送文件。

## 根因与修复清单

- [x] ~~诊断模块长期启用文件选择拦截~~。原来启用了 `Page.setInterceptFileChooserDialog`，却没有消费文件选择事件；人的操作也被吞掉。诊断不再接管文件选择。只有 agent 输入动作持有短暂拦截范围，成功、失败及超时均恢复。超时后继续执行的旧动作不能再发送输入。
- [x] ~~有“待选文件”标记，没有实际选文件能力~~。新增 `browser_upload`，使用 Chromium `DOM.setFileInputFiles` 将明确的绝对路径交给网页实际打开的文件控件。沿用网页自己的上传事件和请求，不替换网站业务 API，不操作系统文件管理器。
- [x] ~~隐藏文件控件不能进入待选状态说明~~。真实选择事件产生 `chooserId`；动作回执、地图及地图分页保留待选提示、`multiple` 和 `accept`。支持附件按钮与文件一次调用，也支持先点击、随后使用 `chooserId`。
- [x] ~~默认地图跳过跨域 frame，点击仍在主文档找节点~~。有跨域子 frame 时使用逐 frame 观察，优先按 Electron 实际 frame 身份读取；点击在所属上下文定位，再逐层检查真实 iframe 的位置、缩放和遮挡。
- [x] ~~Electron 原生输入停在跨进程 iframe 外壳~~。实际复现主文档收到 iframe 点击、子文档没有收到。对此使用 Chromium 的 CDP 原生输入路由，子文档收到可信的 pointer/click 事件。没有使用 DOM `.click()` 代替 agent 点击。
- [x] ~~跨进程文件选择没有被接管~~。当前 Chromium 主页面的 `Page.getFrameTree` 不包含这些子进程 frame。按 protocol parent ID 收集本页后代并拦截对应会话，不按 URL 猜所属网页。
- [x] ~~旧选择、失效节点、重复调用可能选错或重复上传~~。选择绑定任务、标签页、模式和实际节点。新点击不复用旧选择；节点移除不自动改投替代节点；选择在发出前同步消费，并发与重放只允许一次。
- [x] ~~选入文件就可能被误报上传成功~~。回执区分 `filesSelected` / `selectionUnconfirmed`，并明确 `uploadCompletion: notVerified`。页面立即重置或移除 input 时保留原生事件的选择记录；无法确认时要求查看网页而不是重复上传。

## 参考与工作边界

[Playwright 文件上传文档](https://playwright.dev/docs/input#upload-files)及其 [Chromium 实现](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crPage.ts)把文件交给真实 input，不驱动原生文件管理器，也不替网站调用上传业务 API。本轮采用同样的工作边界。

[CDP Page 协议](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Page.pdl)定义选择拦截、frame 和可选 backend node 身份；[Electron 官方问题 #20333](https://github.com/electron/electron/issues/20333)记录 `sendInputEvent` 在 iframe 上的问题。本轮用当前 Electron 43.6.0 再次复现，并通过可信事件及真实文件接收验证修复。

支持 HTML `input[type=file]`，包括隐藏控件、多文件、开放 Shadow DOM、跨域 iframe。上传前校验本地路径、普通文件及可读性。目录选择和没有 HTML input 的原生文件系统选择 API 暂不支持，返回明确错误；不伪造完成。

## 验证

- `apps/desktop/e2e/native-browser-upload.mts` 使用完整生产 controller、真实 Electron、真实临时文件及本地 HTTP 上传接收端。覆盖隐藏控件、待选地图、任务隔离、数量限制、多文件、input 重置/移除、旧选择、防重放、错误恢复、Shadow DOM、跨域 iframe、同 URL 的不同 iframe、遮挡与并发。
- Rust `/tools/browser/upload` 的参数经过真实 TypeScript host 再进入 Electron：上传效果不能降级为 `observe` 或 `editDraft`，文件内容由网页实际收到。
- Linux/X11 的可选弹窗检查在所有 agent 动作后启动生产诊断，再直接点附件；检测到新增的 `xdg-desktop-portal-gtk` **Open File** 原生窗口，没有选择文件。
- 新增输入范围超时回归：拦截已恢复，旧异步动作不能再触发输入。
- 既有 Electron 输入回归、Chromium 非视觉回归、工具目录和提示快照同时检查。

详细输出保存在 `/tmp/lyra-upload-fixes-20260927/`。仓库原有检查失败单列，不把全仓检查称为通过。实际 Gmail 验收仍需用户重启本地 Lyra 后重复第一个附件点击，并让 agent 添加一个明确指定的测试文件；这两步没有在用户真实邮箱中自动执行。

### 最终检查结果

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| Electron 上传与原生弹窗 | 正常 | 17 项通过，包含同 URL iframe、并发一次性选择、真实原生窗口 |
| Electron 既有输入 | 正常 | 13 项通过 |
| Chromium 非视觉操作 | 正常 | 75 项通过 |
| 新上传 host、范围超时、诊断回归 | 正常 | 9 项通过 |
| Rust 上传效果约束 | 正常 | 禁止 observe/editDraft 降级，upload 正常分发；真实 host 贯通 |
| Rust 工具目录与提示快照 | 正常 | 目录 45 项、提示 2 项通过；快照差异已审阅 |
| 既有 semantic fixture | 已有问题 | 12 个失败与本轮之前名称完全一致；32 项通过 |
| 全桌面类型检查 | 已有问题 | 94 个诊断，文件和 TS 错误码与前轮最终基线一致，本轮新增文件无诊断 |
| 结构检查 | 已有问题 | 5 个旧违规（3 个 Rust 文件长度、2 处 storage roots） |
| Clippy | 已有问题 | bootstrap-installer 4 个旧错误 |
| 构建 | 正常 | 桌面 main/preload、lyrad 构建完成；12 项 native 资源已暂存 |

本轮没有重启用户正在运行的应用。新主进程与新工具目录需要重启 Lyra 后生效。
