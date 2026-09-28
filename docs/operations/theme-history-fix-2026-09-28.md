# 跟随系统主题与历史会话删除调查

日期：2026-09-28。环境：Linux / Sway / Wayland，Electron 43.6.0。

## 固定复验动作

1. 系统保持暗色，在外观设置选择浅色，再选择 Lyra System，界面应恢复暗色。
2. 鼠标移到历史会话，第一次点击删除应出现确认框；取消不删除，确认才删除。

## 主题：已修正状态来源与同步

实机读取的 `org.gnome.desktop.interface color-scheme` 为 `prefer-dark`，GTK 主题为
`Yaru-blue-dark`，桌面 portal 的 `org.freedesktop.appearance color-scheme` 为 `1`。
用户保存的 Lyra 偏好为 `lyra-system`，不是选错了浅色。

同版本独立 Electron 实验能正确读取暗色，显式浅色再切系统也正常；调试器的焦点模拟
启用、关闭和脱离均未改变结果。因此没有证据将问题归为 Sway/Wayland 普遍不兼容。

原实现存在两个独立状态源：主进程用 `nativeTheme`，界面用 `matchMedia`。
界面只订阅后续事件，没有订阅后的初始校准，也不能纠正原生主题与网页媒体查询不一致。
这属于已确认的同步缺口；原问题发生瞬间的主进程与页面值没有同时捕获，具体触发条件未确证。

修改后，原生 `nativeTheme` 通过读取接口和更新事件向界面提供状态。先订阅再读取，旧读取
结果不能覆盖新事件；窗口恢复焦点或可见状态时重新核对。网页媒体查询作为没有桌面桥接
时的后备；收到原生状态后不再覆盖应用主题。系统主题更新同时更新不透明窗口背景。

依据：[Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)
定义了 `themeSource` 和 `shouldUseDarkColors` 的关系；
[桌面 portal Settings](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html)
定义 `color-scheme=1` 为暗色偏好。参考目录的 VS Code 在 Linux 保留系统主题探测，
OpenCode 的原生标题栏处理也不把解析出的界面颜色当成 Linux 系统偏好写回。

## 删除：已确证并复现根因

历史会话行的鼠标悬停和焦点事件都会读取预览。原代码使用
`disabled = opening || busy`，把预览读取与修改操作混在一起。
指针进入行后开始读取；按钮可能在点击前或获得焦点时被禁用，导致点击事件无法打开确认框。
原来的 `fireEvent.click` 测试跳过鼠标进入、按下和焦点过程，所以一直通过。

修改后只在真正修改会话期间禁用操作。预览的加载状态仍通过 `aria-busy` 表达；
子按钮获得焦点不再触发行预览。删除、收藏及打开会话不再等待无关的预览读取。
确认框仍是实际删除的前置步骤，没有改成直接删除。

新增回归用例让预览一直未完成，再执行完整的 `userEvent.click`。
旧代码无法弹框，修改后首次点击弹框，确认前没有删除调用，确认后调用正确的会话 ID。

参考 OpenCode 的会话删除流程：确认动作等待实际删除；无关的预览读取不作为删除确认的前提。

## 验证记录

| 操作或检查 | 状态 | 结果 |
| --- | --- | --- |
| 系统主题读取 | 正常 | gsettings、portal 都返回暗色 |
| 旧版删除完整鼠标过程 | 异常，已定位 | 预览加载禁用按钮，确认框不出现 |
| 修改后首次点击删除 | 正常 | 真实 Electron 窗口显示确认框 |
| 确认删除测试会话 | 正常 | UI 行移除，后端列表也不再包含该会话 |
| 外观设置：浅色 → 跟随系统 | 正常 | 真实 Electron 窗口恢复暗色 |
| 强制网页媒体查询为浅色 | 正常 | 媒体查询为 false，原生状态为暗色，Lyra 仍显示暗色 |
| 相关单元与组件测试 | 通过 | 8 个文件，72 项测试 |
| 主进程、预加载构建 | 通过 | 两者均已重新构建 |
| 完整 TypeScript 检查 | 仍有既有问题 | 94 条诊断；本次新增主题文件无诊断 |
| 结构检查 | 仍有既有问题 | 3 项 Rust 文件长度、2 项原有 storage-root 规则违规 |

真实窗口测试使用 `/tmp/lyra-ui-probe-*` 的独立数据目录，只创建和删除临时测试会话。
测试中的媒体查询覆盖是主动构造的异常条件，不是对用户原进程状态的测量。

最后复验日志：`/tmp/lyra-ui-final-pass.log`。
截图：`/tmp/lyra-ui-probe-x5JkhR/verified.png`。

用户应重启 Lyra 后重复上面两项操作，以确认原使用环境下的结果。未提交或推送代码。
