# Lyra 记忆架构重构方案：提取压缩合一 + 会话压缩

> **状态**：方案设计阶段
> **创建日期**：2026-06-25
> **目标**：将"每轮调 LLM 提取记忆"重构为"基于 token 填充触发的提取+压缩合一"，降低运行成本，提升上下文利用效率。

---

## 一、当前架构问题分析

### 1.1 现状概览

当前记忆系统有两条独立的 turn 结束后处理链路（`turns.rs:1343-1414`）：

```
turn status == "finished"
  ├── extraction_job → spawn_post_turn_memory_extraction()   ← 每轮调 LLM
  │     └── run_memory_agent_extraction(user_text, assistant_text)
  │         └── call_model_once_non_streaming() → 产出 MemoryCandidateMutation[]
  │
  └── trim_job → spawn_post_turn_session_trim()              ← 每轮检查 token
        └── evaluate() → 若 token > 阈值则裁剪到 cut_store
```

### 1.2 核心矛盾


| 操作                | 触发频率                                 | 实际开销                              |
| ----------------- | ------------------------------------ | --------------------------------- |
| Session Trim      | 每轮触发，但有 token 阈值保护，低于阈值 early return | 大部分轮次近零开销；超过阈值时纯本地操作，**无 LLM 调用** |
| Memory Extraction | **每轮触发，无阈值保护**                       | **每次都要调 LLM**，无论有没有值得记忆的内容        |


Session Trim 的卖点是零 token 开销裁剪，但 Memory Extraction 每轮白烧一次 LLM 调用，自相矛盾。绝大多数轮次产出 `{"candidates": []}`，等于花钱买空结果。

### 1.3 其他问题

1. `**assistant_text` 包含全部输出**：当前传给记忆 Agent 的是完整的 assistant 文本，包含工具折叠区的中间推理和工具输出，大量噪声
2. **提取与裁剪割裂**：记忆提取和上下文裁剪是两个独立流程，没有协同
3. **用户无感知**：上下文即将耗尽和裁剪发生时，用户完全看不到任何反馈

---

## 二、重构方案

### 2.1 核心思路

**一次 LLM 调用，两个产出：记忆候选 + 上下文压缩摘要。**

将"每轮提取"改为"基于 token 填充阈值触发的提取+压缩合一"。Agent 输出中的**工作折叠区不参与提取压缩**，只有**总结输出**进入流程。

### 2.2 架构对比

#### 现状

```
每轮 turn 结束
  ├── [每轮] 记忆提取 LLM 调用 → 记忆候选 → SQLite
  └── [每轮] token 检查 → 超阈值 → 裁剪（纯本地）
```

#### 重构后

```
每轮 turn 结束
  ├── [每轮] token 填充率检查（纯本地，轻量）
  │     ├── < 阈值 → 什么都不做
  │     └── ≥ 阈值且有未压缩消息 → 异步触发提取+压缩
  │           └── 单次 LLM 调用（~10K 总结输出）
  │                 ├── 产出 1：记忆候选 → SQLite
  │                 └── 产出 2：压缩摘要 → 替换 session 中的旧消息
  │
  ├── [每轮] token 回退 → 圆环 UI 更新
  │
  └── [兜底] 裁剪阈值检查（保留现有 Session Trim 全部逻辑）
        └── 仅在压缩未覆盖的情况下触发
```

### 2.3 Agent 输出结构与输入过滤

Lyra Agent 的消息结构分为两部分：

```
┌──────────────────────────────────┐
│  工作折叠区（tool calls,         │  ← 不进入提取压缩
│  中间推理, 工具输出, 图片等）      │     由 Session Trim 负责
├──────────────────────────────────┤
│  总结输出（最终给用户看的文本）     │  ← 仅这部分进入提取压缩
└──────────────────────────────────┘
```

**提取压缩的输入只包含每轮的总结输出**，不包含工作折叠区。这意味着：

- 输入天然精简，~10K tokens 大约覆盖 8-20 轮的总结输出
- 轻量模型 10K input 完全能胜任
- 提炼出来的压缩摘要质量有保障

### 2.4 提取压缩的触发机制

#### 阈值设计

采用**绝对 token 数**而非百分比，更稳定可预测：


| 参数                           | 值             | 说明                 |
| ---------------------------- | ------------- | ------------------ |
| `EXTRACT_COMPRESS_THRESHOLD` | 30_000 tokens | 累计新增 token 达到此值时触发 |
| `EXTRACT_INPUT_TARGET`       | 10_000 tokens | 单次提取压缩的输入上限        |
| `EXTRACT_INPUT_MAX`          | 15_000 tokens | 弹性上限（适配消息完整性）      |


**计算逻辑**：

```
累计新增 = 当前 session 总 token - 上次压缩后的 token 基线
如果 累计新增 ≥ EXTRACT_COMPRESS_THRESHOLD：
    取自 compressedUpToMessageOrdinal 之后的总结输出消息
    按 token 累加，以消息为边界切割
    目标 ~10K，弹性上限 15K
    触发提取+压缩
```

#### 消息边界弹性

10K 不是硬限制，以消息为边界切割：

```
已选消息 tokens: 9,200
下一条消息: 1,500 tokens
→ 9,200 + 1,500 = 10,700 → 未超过弹性上限 15K → 放宽包含这条

已选消息 tokens: 9,200
下一条消息: 15,000 tokens（异常大的单条消息）
→ 9,200 + 15,000 = 24,200 → 超过弹性上限 → 放弃，就用已选的 9,200

已选消息 tokens: 2,000（不到 10K 但已是全部剩余）
→ 2,000 就是全部未压缩消息 → 完整给到
```

#### 触发条件汇总

提取+压缩在以下条件**全部满足**时触发：

1. turn 结束且 `status == "finished"`
2. 累计新增 token ≥ `EXTRACT_COMPRESS_THRESHOLD`
3. 存在 `compressedUpToMessageOrdinal` 之后的总结输出消息
4. 当前没有正在执行的提取压缩任务（避免并发）
5. 用户当前空闲（复用现有的后台线程 + 空闲检测逻辑）

### 2.5 单次 LLM 调用的双产出

#### 输入格式

```json
{
  "role": "user",
  "content": {
    "task": "extract_and_compress",
    "sessionId": "...",
    "turnId": "...",
    "messages": [
      {
        "messageId": "msg-001",
        "turnOrdinal": 1,
        "role": "user",
        "text": "用户消息的总结输出..."
      },
      {
        "messageId": "msg-002",
        "turnOrdinal": 2,
        "role": "assistant",
        "text": "Agent 的总结输出..."
      }
    ]
  }
}
```

#### 输出格式

```json
{
  "memoryCandidates": [
    {
      "fact": "short durable fact",
      "category": "user_profile|preference|project|instruction|goal|other",
      "scope": "global|project",
      "confidence": 0.0,
      "sensitivity": "low|personal|sensitive",
      "sourceType": "user_declaration|memory_agent_inference",
      "requiresConfirmation": true,
      "content": {"kind": "brief_type", "text": "fact or structured value"},
      "expiresAt": null
    }
  ],
  "compressedContext": {
    "summary": "结构化的上下文摘要...",
    "keyDecisions": [
      {"turnOrdinal": 3, "decision": "选择方案 A 作为架构基础"},
      {"turnOrdinal": 15, "decision": "修复 memory_store 并发 bug"}
    ],
    "projectState": {
      "currentTask": "实现 Plan Mode 流程",
      "progress": "完成了基础框架，待集成 todo 系统",
      "blockingIssues": []
    },
    "compressedMessageIds": ["msg-001", "msg-002", "..."],
    "tokenEstimate": 8500
  }
}
```

#### 压缩摘要结构说明


| 字段                     | 用途                         |
| ---------------------- | -------------------------- |
| `summary`              | 叙述式摘要，保留整体对话脉络             |
| `keyDecisions`         | 关键决策链，按 turn 索引，防止信息丢失     |
| `projectState`         | 当前项目状态快照，让主 Agent 知道"我在哪"  |
| `compressedMessageIds` | 被压缩的原始消息 ID，用于防止重复压缩 + 可调查 |
| `tokenEstimate`        | 压缩后的 token 估算              |


### 2.6 压缩产物在 Session 中的存储

#### 替换方案：方案 C（结构化压缩块 + 可调查原始消息）

压缩后 session 消息列表变化：

```
压缩前:
  [msg1-总结][msg2-总结]...[msg30-总结] | [msg31-总结]...[msg40-总结]
  ├────────── 累计 ~35K ──────────────┤   ├── 最近消息（不压缩）──┤

压缩后:
  [compressed-context-block] | [msg31-总结]...[msg40-总结]
  ├─ ~8K（结构化摘要）─────┤   ├── 原样保留 ──────────────┤
```

#### Session Snapshot 中的新增字段

```json
{
  "memoryCompression": {
    "lastCompressionTurnId": "turn-xxx",
    "lastCompressionAt": "2026-06-25T12:00:00Z",
    "compressedUpToMessageOrdinal": 30,
    "compressedTokenBaseline": 8500,
    "compressionBlockId": "compressed-ctx-001"
  }
}
```


| 字段                             | 用途                          |
| ------------------------------ | --------------------------- |
| `compressedUpToMessageOrdinal` | 标记"到第几条消息为止已被压缩"，新增消息从此之后开始 |
| `compressedTokenBaseline`      | 压缩后的 token 基线，用于计算"累计新增"    |
| `compressionBlockId`           | 压缩块的 ID，用于 Agent 调查工具定位     |


#### 滚动压缩策略

采用**单压缩块替换**（C-1 方案）：

```
第一次压缩: [compressed: 1-30轮] [msg31]...[msg40]
第二次压缩: [compressed: 1-42轮] [msg43]...[msg50]
```

每次压缩都是把"当前压缩块 + 新增未压缩消息"一起重新压缩，产出一个新的压缩块替换旧的。

**理由**：

- 压缩输入本身已是总结输出（高密度信息），再次压缩信息损失可控
- 对主 Agent 来说永远只需看一个压缩块 + 最近原始消息，认知负担最小
- 不需要管理多个压缩块的合并策略

### 2.7 Agent 调查工具

主 Agent 可以通过工具调取被压缩的原始总结：

```
工具: memory.read_compressed_context
参数:
  - sessionId: string
  - blockId?: string     // 压缩块 ID，默认最新的
  - turnRange?: [number, number]  // 可选，只读取特定 turn 范围

返回:
  - summary: string      // 压缩摘要
  - originalMessages: [  // 被压缩的原始总结输出
      { turnOrdinal, role, text }
    ]
  - keyDecisions: [...]
  - projectState: {...}
```

**使用场景**：主 Agent 在处理复杂任务时，如果发现压缩摘要中的信息不够详细，可以调取原始总结查看。

### 2.8 圆环 UX 设计

#### 位置

输入框下方、底部状态栏最右侧。

#### 数据源

```
tokenUsageRate = sessionTotalTokens / contextWindowSize
```

runtime context 中已有 `session_token_count` / `context_window` 数据，直接传给前端。

#### 状态流转

```
正常使用（绿色）
  │
  ▼ token 填充率上升
  │
触发阈值（黄色，带脉冲动画）
  │
  ▼ 异步提取+压缩完成
  │
回退（绿色，带回退动画）  ← 圆环视觉"退回去"，用户看到惊喜感
  │
  ▼ 继续使用，再次上升
  │
裁剪阈值（红色，极少出现）
  │
  ▼ Session Trim 兜底裁剪
  │
回退（橙色）
```

#### 分段颜色


| 区间               | 颜色   | 含义        |
| ---------------- | ---- | --------- |
| 0% - 40%         | 绿色   | 正常使用      |
| 40% - 提取阈值（~60%） | 绿色   | 正常使用      |
| 提取阈值 - 提取完成      | 黄色脉冲 | 即将/正在提取压缩 |
| 提取完成 - 裁剪阈值      | 绿色   | 压缩后回退     |
| 裁剪阈值（82%+）       | 红色   | 兜底裁剪即将触发  |


#### 数据推送

通过现有的 Agent Runtime Event 推送：

```json
{
  "kind": "contextCompressionProgress",
  "sessionId": "...",
  "status": "started|completed|failed",
  "tokenBefore": 35000,
  "tokenAfter": 12000,
  "tokensSaved": 23000
}
```

前端收到 `completed` 事件后，更新圆环进度为回退后的值，播放回退动画。

---

## 三、与现有 Session Trim 的关系

### 3.1 职责划分


| 机制                   | 职责                  | 触发条件                  | 开销        |
| -------------------- | ------------------- | --------------------- | --------- |
| **提取+压缩（新）**         | 有意识的整理：提炼记忆 + 结构化压缩 | 累计新增 ≥ 30K tokens     | 一次 LLM 调用 |
| **Session Trim（保留）** | 紧急断路保护：纯本地裁剪        | token > 裁剪阈值（50K-82K） | 零 LLM 调用  |


### 3.2 为什么保留 Session Trim

1. **兜底**：提取压缩可能被跳过（已压缩过、模型失败、用户连续快速发消息），裁剪是最后防线
2. **工具折叠区**：提取压缩只处理总结输出，工具折叠区的 token 膨胀仍由 Session Trim 负责
3. **紧急情况**：用户突然粘贴大量内容导致 token 暴涨，需要即时裁剪

### 3.3 交互时序

```
正常情况（理想路径）:
  token 增长 → 触发提取压缩 → token 回退 → 继续增长 → 再次触发 → ...
  （Session Trim 永远不触发）

异常情况（兜底路径）:
  token 增长 → 提取压缩已执行过 → 消息继续增长 → 超裁剪阈值
  → Session Trim 兜底裁剪
  （这种情况说明提取压缩的摘要仍然太大，或工具区膨胀过快）

并发冲突处理:
  如果已有待执行的提取压缩任务，Session Trim 裁剪时应跳过属于压缩范围内的消息
  （压缩范围：compressedUpToMessageOrdinal 之前的总结输出消息）
```

---

## 四、代码变更规划

### 4.1 Rust 后端（lyra-agent-runtime）

#### 新增文件


| 文件                          | 职责                 |
| --------------------------- | ------------------ |
| `memory_compress.rs`        | 提取+压缩合一的主流程        |
| `memory_compress_schema.rs` | 压缩摘要的 schema 定义和解析 |


#### 修改文件


| 文件                           | 变更                                                                      |
| ---------------------------- | ----------------------------------------------------------------------- |
| `turns.rs`                   | 移除 `extraction_job`；新增 `compress_check_job`（token 填充率检查）                |
| `memory_event_trigger.rs`    | 移除 `EVENT_TURN_COMPLETED` 的记忆提取触发；保留 tool/file/decision 事件触发            |
| `memory_autonomy.rs`         | 保留 `run_memory_agent_extraction`（供事件触发使用）；新增 `run_extract_and_compress` |
| `memory_token_checkpoint.rs` | 改为由提取压缩流程内部管理，不再作为独立触发                                                  |
| `memory_job_budget.rs`       | 移除 `EVENT_TURN_COMPLETED` 的优先级；新增 `EVENT_EXTRACT_COMPRESS`              |
| `session_trim/pipeline.rs`   | 新增：跳过已被压缩覆盖的消息（`compressedUpToMessageOrdinal` 保护）                       |
| `context_builder.rs`         | 新增：识别 compressed-context-block 类型的消息，注入到 prompt                         |
| `session_snapshot` 相关        | 新增 `memoryCompression` 字段                                               |
| `native_backend/mod.rs`      | 注册新模块、新工具                                                               |


#### 新增工具


| 工具                               | 路径                                      | 用途               |
| -------------------------------- | --------------------------------------- | ---------------- |
| `memory.read_compressed_context` | `/tools/memory/read_compressed_context` | Agent 调查被压缩的原始总结 |


#### 新增 Event


| Event Kind                    | 用途                     |
| ----------------------------- | ---------------------- |
| `contextCompressionStarted`   | 压缩开始（前端显示黄色脉冲）         |
| `contextCompressionCompleted` | 压缩完成（前端回退圆环）           |
| `contextCompressionFailed`    | 压缩失败（前端保持当前状态，降级为裁剪兜底） |


### 4.2 TypeScript 前端（apps/desktop）

#### 新增文件


| 文件                                                | 职责             |
| ------------------------------------------------- | -------------- |
| `modules/workbench/ai-panel/context-ring.tsx`     | 圆环组件           |
| `modules/workbench/ai-panel/use-context-usage.ts` | token 使用率 hook |


#### 修改文件


| 文件                                          | 变更                              |
| ------------------------------------------- | ------------------------------- |
| `shared/agent.ts`                           | 新增 `ContextCompressionEvent` 类型 |
| `modules/workbench/ai-panel/input-area.tsx` | 底部集成圆环组件                        |
| `main/agent/runtime-event-forwarder.ts`     | 转发压缩事件到渲染进程                     |


### 4.3 Prompt 变更

#### 移除

- 现有 `MEMORY_AGENT_SYSTEM_PROMPT`（每轮提取的 prompt）— 不完全移除，改为仅供事件触发使用

#### 新增

- `EXTRACT_AND_COMPRESS_SYSTEM_PROMPT`：提取+压缩合一的 system prompt
  - 指令：同时输出 `memoryCandidates` 和 `compressedContext`
  - 强调：只处理总结输出，忽略工具区内容
  - 结构化输出约束：JSON schema

### 4.4 数据库变更

#### memory.sqlite

- `memory_jobs` 表新增 job_type：`extract_and_compress`
- 无需 schema migration，新 job_type 向后兼容

#### session SQLite

- session snapshot JSON 新增 `memoryCompression` 字段
- `compressed_context_blocks` 表（存储压缩块的详细数据，供调查工具查询）

---

## 五、实现优先级

### Phase 1：核心流程（MVP）

1. `memory_compress.rs`：提取+压缩合一的 LLM 调用
2. `turns.rs`：改为 token 填充率检查触发
3. `context_builder.rs`：识别压缩块并注入 prompt
4. session snapshot `memoryCompression` 字段

### Phase 2：前端 UX

1. 圆环组件 + token 使用率 hook
2. 压缩事件推送 + 动画

### Phase 3：完善

1. `memory.read_compressed_context` 调查工具
2. Session Trim 与压缩的协调保护
3. 失败重试 + 降级策略

---

## 六、风险与缓解


| 风险            | 影响                    | 缓解                                               |
| ------------- | --------------------- | ------------------------------------------------ |
| 压缩摘要丢失关键决策    | 主 Agent 做出错误判断        | `keyDecisions` 结构化字段 + 调查工具可查看原始总结               |
| 提取压缩 LLM 调用失败 | 上下文持续膨胀               | Session Trim 兜底裁剪（现有逻辑）                          |
| 压缩与裁剪并发冲突     | 消息被重复处理或丢失            | `compressedUpToMessageOrdinal` 保护 + Trim 跳过已压缩范围 |
| 滚动压缩信息退化      | 多次压缩后摘要质量下降           | 输入本身是总结输出（高密度），退化可控；未来可引入压缩质量评估                  |
| 圆环回退动画延迟      | 压缩异步执行，用户可能在等待期间继续发消息 | 压缩期间新消息正常写入，压缩完成后一次性更新圆环                         |


---

## 七、未来演进

1. **压缩质量评估**：压缩后对摘要做质量评分，低质量时回退到原始消息
2. **自适应阈值**：根据对话模式（简单问答 vs 复杂项目）动态调整触发阈值
3. **多压缩块合并**：如果滚动压缩产生多个压缩块，定期合并
4. **跨会话压缩记忆**：压缩摘要中的项目状态可以跨会话传递
5. **用户主动触发**：用户可以手动触发"压缩当前上下文"操作

