# MiMo Pro 工具名不在活动 schema：最新会话调查

Audience: Internal
Status: Active
Last verified: 2026-09-28

本次只读调查会话和产品代码，未修改产品实现、未重启或重试用户任务。

会话：`session-ebc85e61-8116-4f49-a20c-a71acfd15dd1`。
出错轮：`turn-cc967b78-42a0-421b-af53-a66b7bcb99fe`。
用户请求是查看 GitHub 主页图片的实现方式；模型为 `mimo_token_plan_cn / mimo-v2.6-pro`。
来源为该会话 SQLite 的 session_dialog、session_bundle，采用只读连接。

## 错误含义

Lyra 已经收到一个含函数名的流式工具调用，但名字无法匹配当轮允许的工具集合。
这是本地协议校验抛出的错误，不是 MiMo 返回的 HTTP 余额/认证错误，也不能由此证明网络故障。

`openai_common/tools.rs` 把这种“未知工具名”归到 IncompleteToolCall，与“缺少函数名”混在一起。
错误没有保留原始函数名或当轮工具集合。上层又把 stop reason 写死为 unknown。
因此，显示的 unknown 不证明供应商未发送结束原因，toolCallCount=0 也不证明模型没有生成调用。

## 时间线

时间：2026-09-28 America/New_York，EDT / UTC−4。

| 时间/阶段 | 动作 | 状态 | 证据 |
| --- | --- | --- | --- |
| 15:06:17.618–19.141 | 生成 GIF 抽帧拼图 | 正常 | ffmpeg 返回 exitCode=0，生成 `/tmp/yetone_montage.png` |
| 15:06:23.904–24.331 | browser_navigate 打开本地拼图 | 异常 | `lyraLumenRuntimeError: Object has been destroyed` |
| 15:06:32.130–32.475 | 再次执行同一导航 | 异常 | 同样的 destroyed 错误；没有恢复浏览器实例 |
| 15:06:42.175–42.275 | ToolSearch 精确加载两个图片工具 | 正常 | 明确返回 openSource、prepareVisionFallback 已加载，可在下一轮调用 |
| 15:06:50.305–50.520 | 调用 image-viewer.openSource | 工具正常、用途不符 | 返回 `file-manager-…` 实例；实际行为是定位源文件，不是在图片查看器加载图片，也没有回传图像 |
| 本轮两次工具目录刷新 | 重建动态工具列表 | 有问题 | 合计 11.929 秒，最长一次 11.777 秒；最终 discoveredToolNames 中两个图片工具全部消失，仅余浏览器工具 |
| 最后三次供应商请求 | 发生未知工具名错误，两次重试 | 异常，恢复不对症 | 分别 6.920、7.664、5.477 秒，总计 20.061 秒；前两次 recoveryAction=provider_missing_tool_call_retry |
| 15:07:23.040 | 显示最终协议错误 | 失败 | 任务中断，没有返回图片分析 |

目录刷新的单次开始时间没有持久化，不能给最长一次杜撰精确时间戳。协议失败的原始函数名也没有持久化，不能断言三次都调用了 prepareVisionFallback。

## 已确认的实现缺陷与推断边界

**已确认：动态工具会在刷新中丢失，而且当前实现把失败与空目录混淆。**

1. `tool_catalog_revision.rs` 把所有 `software*` 调用都当作可能改变目录，包括普通 openSource。
2. `tool_fs/registry.rs:software_manifests_with_diagnostics` 查询失败时返回空 manifests；上层 dynamic_capability_manifests 丢弃 diagnostics。
3. `tool_search.rs:persist_discovered_snapshot` 只保留当前目录里仍存在的发现项，直接覆盖已发现列表。
4. 因此临时查询失败可以变成永久撤掉已发现工具。最终会话快照确实已经丢掉刚加载并成功调用过的图片工具。

**高置信推断：这次是动态目录刷新异常后丢失图片工具，模型继续按历史中的“已加载”承诺调用，从而触发校验错误。** 桌面目录 IPC 默认 5 秒超时，11.777 秒的刷新与重复查询超时相符。但没有保存刷新时的原始错误/目录响应和最后三次原始调用，不能把“IPC 超时”或具体函数名当作已经捕获的事实；也不能完全排除模型另外拼错名称。

**已确认：恢复策略不对症，且诊断信息丢失。**

未知工具名被当作没有工具调用，重试提示宣称上一条没有发 structured tool_call，只催模型再发。
这条重试分支没有重建并核对动态目录，没有告诉模型实际失效的名称。
如果支持 tool_choice，还尝试 Required。MiMo 的[官方 Chat Completions 文档](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)说明非 auto 的 tool_choice 当前会被后端移除，因此也不能依赖 Required 修复该情形。

**另有两个独立问题。**

- 浏览器连续报告 Electron 对象已销毁，恢复建议却仍是普通 map；具体是哪个对象及销毁原因，当前结果没有堆栈，尚未确定。
- 模型误把 openSource 当成打开图片。该工具英文说明实际是 “Reveal the image source path in File Manager”，实现也确实只创建文件管理器。prepareVisionFallback 则依赖已有图片查看器的 filePath，二者并不能按模型设想直接串起来。

当前会话记录的 promptTemplateVersion=62、toolDiscoveryContractVersion=3，说明这次已使用上一轮构建的新版提示契约；不能再解释成没重启所以沿用旧契约。

## 应修复的边界

- 区分成功空目录、明确撤销与临时查询失败；失败不能删除已加载工具。普通软件动作不应重复重建所有能力。
- 未知名称与缺失调用分开处理；保留经过限制的原始名称、活动 schema 标识、真实停止原因和目录诊断，再提供针对性的重新发现/纠错路径。
- 名称无法确认时不模糊映射到另一个可执行工具，也不放松执行白名单。
- 本地图片的打开、显示和提供模型图像证据要有明确契约；不能把文件管理器定位成功当作看过图片。
- 浏览器对象生命周期单独复现，不能用 provider 重试掩盖本地 destroyed 错误。

本报告不声称已修复以上问题。
