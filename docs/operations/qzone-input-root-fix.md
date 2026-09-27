# QQ 空间输入问题：根因修复与验收

日期：2026-09-26。分支：`research/surface-browser-map`。

这是 [修复前调查](qzone-input-investigation.md) 的实施记录。线上截图的最终灰色残留由哪个 QQ 空间回调造成，原会话没有留下足够证据；本次针对已经复现的输入执行、验证和读取缺陷修改公共实现，没有写 QQ 空间专用判断。

## 修复清单

- [x] ~~编辑器首次输入跳过点击初始化，文案和占位提示混在一起。~~ 首次进入使用真实指针点击，重新确认实际编辑宿主；点击创建的新编辑器只在原输入区域内接续。已有焦点或有效文字选区继续保留。不会自动清空未知正文。
- [x] ~~普通文本直接通过 DOM setter / execCommand 改写，再重复补发 input/change。~~ 普通输入框和富文本编辑器统一通过 `webContents.insertText`；空文本清除通过真实 Delete。保留浏览器的 beforeinput 拒绝、maxlength、原生撤销与富文本格式。日期、颜色等没有通用文字光标的原生控件保留独立的值设置路径，并明确返回 `nativeFormValue`。
- [x] ~~只要文字发生变化就报告成功，甚至读的是已经被替换的旧节点。~~ 比对期望结果与存活宿主，在输入事件处理后、生成反馈地图后各校验一次。拒绝、截断、异步重置、宿主替换会报告失败并要求读取当前状态，不自动重复输入。
- [x] ~~普通 read 只读取外层导航，遗漏 iframe 中的正文。~~ 同源 iframe 按页面结构读取；跨域 iframe 使用自己的 Electron 执行上下文，核验嵌入位置、可见性及视口裁剪。普通文本读取、DOM 摘要正文和语义定位共享这条路径。无法读取或超过预算时明确标注不完整。
- [x] ~~隐藏 iframe 被丢弃后，后面的可见 iframe 被错配。~~ 零尺寸 owner 保留身份；先在所有兄弟 frame 中保留明确 URL/name 对应关系，再处理其他匹配。缺少 owner 时不按位置抢占其他 frame。隐藏内容不会因此成为操作目标。
- [x] ~~动态页面刚返回的分页游标立刻失效，每次翻页还重扫整页。~~ 分页使用按任务、标签页、模式和查询隔离的快照；期限五分钟、最多十六份且有控件总量限制。续页只读取标签页元信息并检查 URL，无需再次收集控件；新查询重新观察。快照里的 targetRef 执行前仍按真实节点解析，快照不是执行成功证明。
- [ ] QQ 空间线上复测：需要重启应用加载主进程构建后，由用户重复原来的操作。

## 验证

固定验收动作：空编辑器 → 输入一次 → 占位提示消失，正文只含目标文案 → 失焦再聚焦仍保留正文。实际发布须另有用户授权；本轮没有登录、代发或重复发表动态。

生产代码的真实 Chromium 回归覆盖占位清理、点击替换编辑器、错误焦点、beforeinput 拒绝、maxlength 截断、同步和异步宿主替换、撤销、Tab、Gmail 式选区/加粗/列表、同源及跨域 iframe、多个无名称 iframe、隐藏内容和视口裁剪。整个回归不读取截图、不调用站点业务 API。

另在 Electron 43.6.0 运行实际 `webContents.insertText`：输入“Lyra 原生输入”后，正文完全匹配，只收到各一次 `beforeinput` 和 `input`，两者 `isTrusted=true`，没有额外的 `change`。

最终结果：

- 真实 Chromium：66/66 通过。
- 定向单元/工具链测试：53/53 通过；frame 匹配最后调整后，其 15 项相关测试再次通过。
- 实际 Electron 原生输入：通过。
- 桌面 main / preload：构建成功。
- 全量类型检查：96 项历史错误，与修改前逐项对照，无新增。
- 结构检查：仍是原有 5 项违规，本次文件没有新增违规。
- 扩展 service 测试仍有原先记录的 3 项失败（两个旧 viewport 断言及登录地图用例），没有把它们计入通过项。

验证日志：

- `/tmp/lyra-qzone-fix-e2e-final.log`：真实 Chromium 回归。
- `/tmp/lyra-qzone-fix-focused-final.log`：输入计划、状态库、地图分页、frame 身份与读取等定向测试。
- `/tmp/lyra-qzone-fix-native.log`：实际 Electron 输入验证。
- `/tmp/lyra-qzone-fix-typecheck-final.log`：类型检查，与修改前基线对照。
- `/tmp/lyra-qzone-fix-build-final.log`：桌面主进程及 preload 构建。

## 实现依据和工作边界

[Electron insertText 文档](https://www.electronjs.org/docs/latest/api/web-contents#contentsinserttexttext) 与 [Chromium Input.insertText 文档](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-insertText) 提供浏览器文字输入通道。这里的批量文字输入类似输入法提交，不会逐字模拟全部物理按键；快捷键仍走键盘工具。

实际阅读了本地 Playwright 1.60.0 的 `_fill` 和 injected `fill`：普通文字选择后交给浏览器 keyboard.insertText，日期等特殊原生控件单独处理。**它不为普通文字通过改 DOM 再补发一套假事件来冒充键盘输入。** Lyra 还需要保留已有选区，并处理先点击才初始化的编辑宿主。

[QQ 空间公开 VEditor 实现](https://github.com/qzone/veditor/blob/master/source/core/editor.js#L1469) 的占位清理绑定了点击/按键等生命周期，支持本次复现机制；不能据此认定当前线上 QQ 空间部署的就是这个历史版本。

本地操作回归通过不等于 QQ 空间线上已经验收。也不能由此承诺整个 agent 任务三十秒完成：原发布任务约 609 秒消耗在 provider 调用，本次没有修改 provider 或 VPN 路径。
