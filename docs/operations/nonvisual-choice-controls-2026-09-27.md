# 单选控件名称、状态与点击修复（2026-09-27）

固定复测动作：在五子棋“新游戏”中依次选择“人机对战 → 黑子 → 中等”。本次处理非视觉控件通路；棋盘视觉编号覆盖留待单独讨论。

## 已核实的原因

原网页三个 fieldset 的 radio 共用同一个 name、同一个 form owner，并重复使用 ID。选择后原生 checked 只保留一个，但页面事件处理器分别保存三组选项，三组标签的选中样式可以同时存在。浏览器原生 labels/AX 名称因此也会串组。

[HTML 单选组规则](https://html.spec.whatwg.org/multipage/input.html#radio-button-state-(type=radio))不会以 fieldset 分隔组；[label 的关联规则](https://html.spec.whatwg.org/multipage/forms.html#the-label-element)依赖目标 ID。参考项目 ZCode 的 `playwright-command.ts` 直接返回 `page.locator("html").ariaSnapshot()`，没有重建冲突控件的证据关系；单纯切换到这条路径不能纠正本例。

Lyra 原实现只呈现 native checked，直接拼接 labels 名称，并把盖在原生输入框上的标签图标报告为外部遮挡。这些信息共同误导模型反复切换。

## 逐项修复

| 状态 | 问题 | 通用处理 |
| --- | --- | --- |
| 已修复 | ~~名称串组或匿名~~ | 优先核实局部唯一的 input/label 关系；正常显式标签、包裹标签和多标签保留原生语义；重复 ID 不跨控件拼名 |
| 已修复 | ~~页面显示选中却简单报告 off~~ | 分开发布 nativeChecked、ARIA、data-state、明确 choice-state class 的来源；冲突时 checked=unknown，保留全部已收集证据，不把 CSS 升格成业务成功 |
| 已修复 | ~~三个显示分组之间相互取消的原因不可见~~ | 使用实际 root、form owner、name 判断原生分组，跨显示组时给出说明；读取 legend 或组内 heading |
| 已修复 | ~~自身标签覆盖被当成外部遮挡~~ | 多点命中全是自身可操作标签时，地图由标签承载对应控件证据；真实覆盖、歧义或未映射标签不合并 |
| 已修复 | ~~正常标签原生转交被防误点保护拦截~~ | 只接受已点击标签到原先原生关联控件的可信事件转交，检查事件链、节点关联与禁用状态；不允许中途改绑 |
| 已修复 | ~~地图与点击回执状态口径不同~~ | 回执使用同一关系和证据读取器；冲突不退化成 checked=false，也不把原生 false 漏成缺失 |
| 已补充，待真实模型验收 | 模型根据冲突反复切换 | 提示明确不能靠循环切换迫使矛盾状态一致；点击目标后根据后续页面结果或验证信息判断 |
| 本次不处理 | 棋盘视觉标注数量、覆盖和玩法 | 保留现状，后续另行讨论 |

产品代码没有网站域名、游戏变量、jQuery Mobile 选择器或特定选项文案。不写网页业务状态，不调用 DOM click()，不拿截图替代非视觉验证。

## 验证

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| Chromium 非视觉生产路径 | 正常 | 97/97，通过真实地图、节点引用和可信输入；新增 10 组 choice 回归 |
| Electron 共享动作回归 | 正常 | 28/28，检查现有视觉动作所用的共享命中保护，没有重构视觉方案 |
| 原五子棋网站三步操作 | 正常 | 生产地图定位和点击均通过；七个选项名称、分组与状态证据完整，七个被自身标签盖住的输入框不再重复报告为 blocked |
| 完整 TypeScript 检查 | 有问题，既有阻塞 | 94 条诊断、74 条去重诊断，与本轮前相同，没有新增诊断 |
| 仓库结构检查 | 有问题，既有阻塞 | 原有 5 项违规，本轮没有新增 |
| Rust browser 过滤集 | 有问题 | 52 通过、1 失败；失败项是动态软件 image-viewer 权限测试等待不到 pending permission，单独重跑仍失败；本轮未改该权限路径，不把整组称为通过 |
| Desktop / lyrad 构建 | 正常 | 构建通过，lyrad 已原子替换到桌面 native 目录；运行中的旧进程需要重启 |
| Rust 格式 / diff 空白检查 | 正常 | `cargo fmt --all --check` 和 `git diff --check` 通过 |
| 真实模型端到端行为 | 待验证 | 本地机制和原站三步验证不能保证模型不再绕路；重启 Lyra 后复测同一任务 |

新增回归还覆盖：正常 checked/unchecked/mixed、独立 form 和 Shadow Root、ARIA 冲突、真实覆盖、disabled、DOM 替换、隐藏/独立子控件的状态不借用，以及标签在点击中改绑的拒绝。

默认回归不访问网站。原站复测需要显式设置 `LYRA_LIVE_CHOICE_TEST=1` 和 `LYRA_TEST_CASE='public choice controls:'`，运行 `apps/desktop/e2e/nonvisual-browser.mts`。日志为 `/tmp/lyra-choice-full-final.log`、`/tmp/lyra-choice-native-visual.log`、`/tmp/lyra-choice-live.log`。
