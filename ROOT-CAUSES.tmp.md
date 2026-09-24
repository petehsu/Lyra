# 临时：会话根治清单

来源会话：`~/.lyra/data/agent/agent-runtime/sessions/session-ef0227f8-9c29-406c-807e-d403b1d87b22`  
标题：`zcode是不是开源了`（2026-09-21，工作目录 = 家目录）

根治一项：把该条改成 `- [x] ~~标题~~`，并在「结案」写清冻住的点击还在、为什么算根治。不要在错帧里打补丁。

建议顺序就是下面的编号。1 不修，后面的交接/失忆还会被喂胖。

---

## 1. 短用户问被冻成巨消息，压缩把原问归档

- [x] ~~用户消息带着整段~~ `turn_tail` ~~/~~ `providerContext.renderedTail` ~~计 token、进 cut~~
  结案：管道拆成三轨。持久化 user 只留打的字和点名附件；组装忽略旧 `renderedTail`；环境每轮短附录，不再 dump runtime JSON；token 只计对话可见文本；压缩一套：保首问 + 中间摘要 + 近期尾，阈值按真实窗口（100k−13k），回合结束不再同时跑 session_trim。
  冻住点击仍在：家目录**新**会话打「zcode是不是开源了」——用量应接近这一句，模型不应把 runtime JSON 当成你说的话；压过之后第一问仍在（原文或摘要里的原话），不必靠读消息 ID。老会话 `session-ef0227f8-…` 再打开时组装必须忽略已冻的 tail。

- [x] ~~一 trim 就强制 Full 系统提示（~52k）~~
  结案：这场 ~52k 是**默认 Full**，不是 trim 把 lean 打回 Full。`ContextTrimmedFullRefresh` 只在 lean 模式才发生。文案从 ~52k 砍到参考项目 2–4k 那档**另开**，不在本管道重构里。

---



## 2. 多 agent：报告进了会话，没进父模型该看的那一截

- [x] ~~父 prompt 叠 worker 报告硬截断 4000 字~~
  结案：删掉 Started 占位 overlay 和 4k `tool_outputs_by_id` 链。后台 spawn 的 tool result 冻在 `Started … subagent_id=`；终报另开 `role: system` / `kind=subagent-completion` 信封，全文进父 prompt，超过 32_000 字才头+尾裁。UI 卡片仍走 `tools[]` 全文。
  冻住点击仍在：新会话派两个后台调查，完成后父下一轮应直接用两份报告（含这场那种后半段 license），不是 4000 字截断，也不必 clone / 读 sqlite。

- [x] ~~poke 只催 fold，不带报告正文；压缩后 Started 锚点可能不在窗口~~
  结案：交付物是信封本身。占位被 exclude/compact 掉时信封仍在。父 idle 无新 user 开回合；忙则排队，idle 一次冲未投递信封。禁止空 user poke。
  冻住点击仍在：worker 完成后的那一轮，父 prompt 里应能直接 fold，不依赖「去别处找」，时间线也不应出现「Background workers updated」。

- [x] ~~父模型不 fold：复勘、hunt tab、python 读子 session.sqlite~~
  结案：那是残通道的产物。通道改成独立完工槽后，不应再出现 `/tmp` 复刻、subagent 标签读取、对 child sqlite 的探查。
  冻住验收：派两个后台调查 → 完成后父回答应直接用 worker 报告。

---



## 3. 交接态污染对话

- [x] ~~系统 poke 当成用户消息~~

  结案：写侧在 §2 已拆（system 信封 + idle resume，不再写 user poke）。这次补读侧：`is_member_user_message` 让首问 / 最新问 / recall 只认人打的字，跳过 `uiHidden`。禁止按 poke 文案特判。

  冻住点击仍在：新会话派两个后台调查，完成后成员时间线没有「Background workers updated」，最新那句问仍是你打的字。老会话里冻着的 poke 也不再抢 recall。

- [x] ~~压缩后 todos 变空~~

  结案：**假前提**。源会话从未 `todo_write`；两条工人 `origin: "spawn"`，不写 `snapshot.todos`。两次空 `todo_read` 发生在最终压缩之前。压缩不碰 todos。没写过 todo 时 `[]` 是对的，不是「没派过工」。

  冻住点击仍在：没写过 todo 时 `todo_read` 为空是对的；若先写入再压上下文，列表应还在。

- [x] ~~Agent 工具 input 被回写成只有 `{turnId}`~~

  结案：§2 里 `publish_parent_subagent_tool` 已读回已有 spawn `input` 再 upsert，不另开项。

  冻住点击仍在：进行中/完成后的 Agent 工具卡仍能看到派发时的调查说明。

- [x] ~~subagent 工作区标签 `observable: false`~~

  结案：对齐参考产品 Don't peek。契约是 fold 信封，不把标签做成第三份报告源。保持拒读。

  冻住验收：不要指望去点 subagent 工作区标签读报告；报告在父下一轮的信封里。

---



## 4. 可见层

- [x] ~~英文进度写进用户可见 `text`~~

  结案：不是 thinking 泄漏。模型 content 在有 tool_calls 时被写成气泡正文。对齐 Hermes：工具轮 commentary 离答案通道。`assistant_reply_visible_text` 在有工具调用时返回空；commit 再剥掉已流式写入的 text 块。终答（无工具）仍进气泡。子会话进度仍镜像到父工具卡，不进气泡。

  冻住点击仍在：中文会话里，折叠标题可以英文工具名，气泡正文不应刷 `I'll check…` / `The head commit…` 这类自言自语。

---



## 5. 记忆（这场不是根因，整库空着）

- [x] ~~长期记忆整库 `memories = 0`；injection `selected_json` 恒 `[]`~~

  结案：**broken trigger**，不是没接线、也不是家目录关掉。`memory_trigger_from_tool` 要求 tool.status==`finished`（那是 turn 状态），生产写的是 `completed`。每次 toolFinished 都被丢弃，jobs/candidates/memories 全 0。injection 已在跑，库空所以恒 `[]`。压缩 MidTurn 故意 `candidates: []` 是旁路。现改为只认 `completed`，复用现有 job 队列，不另开 store。

  冻住点击仍在：另开一场需要跨轮记住的事实（项目约定、成员更正），工具跑完后记忆任务应能入队；下一轮能被注入，而不只是 cut brief。抽取模型仍可 no-op（参考产品允许 Nothing to save）。

---



## 不单开项

- 家目录当 `workingDir`：放大 §1 的 frozen tail，不单独扫文件树。修 §1 时把 home 的 runtime 注入一并收掉。
- spawn 本身是成功的；08:37 父轮结束是背景 agent 设计，不是 occupancy park。
- `workbench_read_tab` 失败是设计拒读，根在「不该去读」，见 §3 最后一条。

---

## 6. 网页/大工具结果被克隆进 runtime 再焊进附录

- [x] ~~同一份 `tools[]` 活动 JSON 进了 tool 消息，又 `take(8).cloned()` 进 `memoryLayers.sessionMemory.recentToolEvidence`，再进附录；那场 ~52k 里约 62% 是最后 8 次 web 工具全文~~

  结案：Hermes 句。结果只在 tool 消息里；进模型前头+尾截断（共用 `clip_chars_head_tail`），全文只在 artifact。`sessionMemory` 只留计数，记忆投影 `toolEvidence` 不再带 `output`，timeline 只留 id/role/短文本。组装期旧 tool 正文就地收成一行占位，只留最近 5 次全文；不写回 sqlite，UI 工具卡仍走 `snapshot.tools`。不加第二抽取模型。

  冻住点击仍在：新会话连续 web_search + 多次 web_fetch，再打一句短问。用量应接近这一句 + 最近几次取页，不应再跳到上万的 runtime dump；气泡/工具卡仍能点开旧 fetch。


