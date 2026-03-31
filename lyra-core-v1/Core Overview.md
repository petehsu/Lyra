## 1. 核心概览（Core Overview）

* **三模式目标**：

  * **Chat**：低门槛实时对话。
  * **Agent**：单体强执行能力，是 Oma 的 Apex。
  * **Oma（Open Multi-Agent）**：多角色协作，基于角色而非执行器。

* **设计原则**：

  * Agent First：Oma 不降低 Agent 单体能力。
  * 并发先约束后执行，强门禁优先。
  * 策略可配置，所有操作可追责。

* **术语**：

  * **Role**：角色，定义任务与交付。
  * **Skill**：技能栈。
  * **Tool**：工具。
  * **Policy**：策略约束。
  * **Ticket**：任务单。
  * **Delegation**：委派契约。
  * **Meeting**：角色协商机制。
  * **Integrator**：收敛结果。
  * **Gate**：质量门禁。

* **首版范围**：

  * 三模式边界、Oma 路由、会议、委派、并发、门禁、集成闭环、Marketplace 流程。
  * 非目标：企业级合规体系、完整经济学仿真。

---

## 2. 模式规格（Mode Specification）

| 维度   | Chat | Agent   | Oma                  |
| ---- | ---- | ------- | -------------------- |
| 内核   | 独立对话 | 共享能力    | 共享 + 编排              |
| 执行主体 | 单助手  | 单 Agent | 多 Role 网络            |
| 委派   | 无    | 可选      | 核心能力                 |
| 并发   | 无    | 有限      | 结构化强约束               |
| 会议   | 无    | 无       | 可选投票会议               |
| 门禁强度 | 低    | 中       | 强                    |
| 交付收敛 | 回合   | 单体结果    | Integrator + Gate 收敛 |

* **模式判定**：显式开关 > 会话粘性 > 入口策略
* **切换状态机**：

  * Chat ↔ Agent ↔ Oma，切换必须记录 switch_id、session_id、from/to mode、原因、触发源、时间戳
* **执行档位**：

  * `chat_readonly`, `agent_standard`, `oma_orchestrated`
* **审批矩阵**：

  * 高风险操作需 explicit-approve
* **Agent Apex 基线能力**：

  * 可独立完成端到端编码任务
  * 跨模块、跨文件执行、可复原
  * 提供可解释执行轨迹

---

## 3. Oma 编排协议（Orchestration Protocol）

* **入口规则**：

  * 无 `@` → Apex 默认角色
  * 单 `@` → 指定角色，可二次分发
  * 多 `@` → 投票决定开会，未通过则并行执行，Integrator 收敛

* **关键对象**：

  * `UserIntentEnvelope`
  * `TaskTicket`
  * `DelegationContract`
  * `MeetingProtocol`
  * `GateReport`
  * `ConflictRecord`
  * `CheckpointRecord`
  * `HumanApprovalTicket`
  * `OmaEventEnvelope`

* **执行图**：

  * 支持 `OmaExecutionGraph`，节点、边、条件、动态并发（map/tree）、循环保护

* **事件流**：

  * intent.accepted, ticket.created, meeting.started/closed, task.updated, gate.finished, delivery.completed

* **恢复机制**：

  * 长任务 checkpoint + 可追溯恢复

---

## 4. 角色与能力模型（Role & Capability Model）

* **四层模型**：Role → Skill → Tool → Policy
* **Role**：

  * mission、deliverables、acceptance_criteria、delegation_scope、escalation_target
  * 默认角色：Apex Agent、PM、Architect、Frontend/Backend Engineer、QA、Security、Integrator
* **Skill**：

  * 跨技术栈复用，如 Backend Engineer + python-fastapi
* **Tool**：

  * analysis/build/delivery/collaboration 工具包
* **Policy**：

  * 权限、质量门禁、安全、成本约束
* **自定义角色状态**：draft → review → published → enabled → suspended → archived
* **角色委派映射**：

  * TaskTicket.owner_role_id 和 DelegationContract.to_role_id 必须启用
* **Apex Agent 角色要求**：

  * 全局理解、强执行、强编排、强责任
* **双形态建议**：

  * planner persona：分析、拆解、验收
  * builder persona：执行与提交

---

## 5. Delivery & Governance

* **并发交付模型**：分支隔离 + Integrator 收敛

  * Role 分支：`oma/<task_id>/<role_slug>`
  * Integrator 分支：`integration/<parent_task_id>`
* **强门禁**：

  * lint、test、security、review、integration
  * 任一失败阻断主线
* **冲突治理**：

  * style/interface/logic/merge → ConflictRecord → resolution_plan → Gate Pipeline
* **审计链路**：

  * UserIntentEnvelope → TaskTicket → DelegationContract → GateReport → ConflictRecord → Final Delivery
* **可观测性基线**：

  * task.started/progress, gate.finished, conflict.opened, delivery.completed
* **Agent First**：

  * Oma 协作不能降低 Agent 单体交付能力

---

## 6. Oma Marketplace

* **概念**：角色社会网络 + 任务交易市场

* **核心对象**：

  * Publisher、Requester、MarketplaceProfile、Engagement、Dispute Case

* **全链路功能**：

  1. 发布（Publish）
  2. 审核（Review）
  3. 发现（Discovery）
  4. 匹配（Matching）
  5. 协作（Collaboration）
  6. 验收（Acceptance）
  7. 结算（Settlement）
  8. 评分（Rating）
  9. 申诉（Appeal）
  10. 仲裁（Arbitration）
  11. 惩罚与恢复（Penalty & Recovery）
  12. 推荐网络（Recommendation Network）

* **评分与信任分公式**：

```
trust_score = 0.35 * quality + 0.20 * timeliness + 0.20 * user_rating + 0.15 * reliability - 0.10 * dispute_penalty
```

* **发布策略**：

  * 自动审核字段完整性、权限越界
  * 人工复核高风险角色
* **Trial & Sandbox**：

  * 小样任务 → 最小 GateReport → 风险说明 → 决定正式履约
* **争议 SLA**：

  * T+24h 受理，T+72h 初判，T+7d 终裁

---

### ✅ 总结

Lyra Core v1 提供了一个**多模式、角色化、可追责和可收敛的多 Agent 协作框架**：

* **模式清晰**：Chat / Agent / Oma 三模式边界与切换可追踪。
* **角色化执行**：Role/Skill/Tool/Policy 四层模型 + Apex Agent 顶层能力。
* **可执行协议**：TaskTicket、DelegationContract、OmaExecutionGraph、Gate、ConflictRecord 等对象保证流程可追踪。
* **治理与交付**：分支隔离、Integrator 收敛、强门禁、审计链路、可回放。
* **Marketplace**：角色发布、匹配、协作、评分、仲裁、惩罚闭环。



