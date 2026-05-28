// ============================================================================
// Lyra Agent UI — Internationalization
// ============================================================================

export type Locale = "zh-CN" | "en-US";

const ZH_MESSAGES = {
  "app.title": "Lyra Agent UI",
  "app.tagline": "Agent 交互体验演示",

  "composer.placeholder": "给 Agent 发送消息",
  "composer.send": "发送",
  "composer.pause": "暂停",
  "composer.followAgent": "跟随 Agent",
  "composer.stopFollowingAgent": "停止跟随 Agent",
  "composer.attach": "附件",
  "composer.poke": "继续未完成事项",
  "composer.modelControls": "模型控制",
  "composer.modelList": "模型列表",
  "composer.configureModel": "配置模型",
  "composer.answerClarificationFirst": "请先回答上方问题",
  "composer.reasoningEffort": "推理强度",
  "composer.fastMode": "高速模式",
  "composer.serviceTierStandard": "标准",
  "composer.attachImage": "添加图片",
  "composer.attachBrowserScreenshot": "浏览器截图",
  "composer.attachWindowScreenshot": "窗口截图",
  "composer.removeAttachment": "移除附件",

  "header.more": "更多",
  "header.bindProject": "绑定项目",
  "header.openProjectTree": "打开项目文件树",
  "header.cancelTurn": "取消当前回复",
  "header.newSession": "新建会话",
  "header.followAgent": "跟随 Agent",
  "header.stopFollowingAgent": "停止跟随 Agent",
  "header.improve": "改进",
  "header.refactor": "重构",
  "header.review": "代码审查",
  "header.judge": "验收检查",
  "header.subagent": "运行子 Agent",
  "header.btw": "旁路问题",
  "header.split": "拆分会话",
  "header.transfer": "转移会话",
  "header.compact": "压缩上下文",
  "header.goals": "目标",
  "header.noGoals": "没有可用目标",
  "header.refreshGoals": "刷新",
  "header.openGoalsOverview": "打开总览",
  "header.resumeGoal": "恢复目标",
  "header.automation": "自动化设置",
  "header.selfdev": "自我改进",
  "header.overnight": "长时间任务",
  "header.subagentType": "类型",
  "header.subagentModel": "模型",
  "header.subagentContinue": "继续会话",
  "header.prompt": "提示词",
  "header.question": "问题",
  "header.autoreview": "自动审查",
  "header.autojudge": "自动验收",
  "header.cancel": "取消",
  "header.run": "运行",
  "header.ask": "提问",
  "header.save": "保存",

  "sidePanel.aria": "Agent 侧栏",
  "sidePanel.source": "来源",

  "runtime.desktopBridgeUnavailable": "Lyra 桌面桥接不可用。",
  "runtime.connecting": "正在连接",

  "scroll.toBottom": "回到底部",

  "decision.submit": "提交",
  "decision.prev": "上一个",
  "decision.next": "下一个",
  "decision.prevQuestion": "上一个问题",
  "decision.nextQuestion": "下一个问题",
  "decision.custom": "自定义",
  "decision.customPlaceholder": "输入你的回答",

  "permission.approve": "允许",
  "permission.deny": "拒绝",
  "permission.prev": "上一个权限请求",
  "permission.next": "下一个权限请求",

  "todo.plan": "执行计划",
  "todo.fallback": "待办 {index}",

  "diff.files": "个文件",

  "debug.title": "调试面板",
  "debug.decisions": "提问面板",
  "debug.permission": "权限申请面板",

  "msg.copy": "复制消息",
  "msg.undo": "撤回",
  "msg.undoMessage": "撤回消息",
  "msg.agentResponding": "Agent 正在回复",
  "msg.rollbackCancelRunning": "请先取消当前回复，再执行回退。",
  "msg.rollbackUnavailable": "这条消息不可回退。",
  "msg.rollbackConfirm": "确认回退",
  "msg.rollbackTitle": "撤销文件和对话",
  "msg.rollbackBody": "回到这条消息发送前，将移除 {messages} 条消息并恢复 {files} 个文件。",
  "msg.rollbackMoreFiles": "+{count} 个更多文件",
  "msg.rollbackCancel": "取消",
  "msg.rollbackBusy": "正在撤销...",
  "msg.rollbackAction": "撤销",
  "msg.rollbackErrorTitle": "无法撤销",
  "msg.rollbackClose": "关闭",
  "msg.noResponseText": "没有收到回复文本。",
  "msg.turnFailedNoResponse": "回复失败，未收到模型回复。",
  "msg.turnFailedWithReason": "回复失败：{message}",
  "msg.imageAttachment": "图片附件",
  "msg.browserScreenshot": "浏览器截图",
  "msg.windowScreenshot": "窗口截图",

  "working": "处理中",

  "tool.ask.prefix": "已询问：",
  "tool.collapseGroup": "收起工具组",
  "tool.collapseCall": "收起工具调用",
  "tool.collapseEditDetails": "收起编辑详情",
  "tool.agentActivity": "Agent 活动",
  "tool.events": "{count} 个工具事件",
  "tool.running": "运行中...",
} as const;

export type AgentChatI18nKey = keyof typeof ZH_MESSAGES;
type Messages = Record<AgentChatI18nKey, string>;

const EN_MESSAGES: Messages = {
  "app.title": "Lyra Agent UI",
  "app.tagline": "Agent interaction demo",

  "composer.placeholder": "Send a message to Agent",
  "composer.send": "Send",
  "composer.pause": "Pause",
  "composer.followAgent": "Follow Agent",
  "composer.stopFollowingAgent": "Stop Following Agent",
  "composer.attach": "Attach",
  "composer.poke": "Continue unfinished todos",
  "composer.modelControls": "Model controls",
  "composer.modelList": "Model list",
  "composer.configureModel": "Configure model",
  "composer.answerClarificationFirst": "Answer the question above first",
  "composer.reasoningEffort": "Reasoning effort",
  "composer.fastMode": "Fast mode",
  "composer.serviceTierStandard": "standard",
  "composer.attachImage": "Add image",
  "composer.attachBrowserScreenshot": "Browser screenshot",
  "composer.attachWindowScreenshot": "Window screenshot",
  "composer.removeAttachment": "Remove attachment",

  "header.more": "More",
  "header.bindProject": "Bind Project",
  "header.openProjectTree": "Open Project Tree",
  "header.cancelTurn": "Cancel turn",
  "header.newSession": "New session",
  "header.followAgent": "Follow Agent",
  "header.stopFollowingAgent": "Stop Following Agent",
  "header.improve": "Improve",
  "header.refactor": "Refactor",
  "header.review": "Code review",
  "header.judge": "Acceptance check",
  "header.subagent": "Run Subagent",
  "header.btw": "Side Question",
  "header.split": "Split Session",
  "header.transfer": "Transfer Session",
  "header.compact": "Compact Context",
  "header.goals": "Goals",
  "header.noGoals": "No goals",
  "header.refreshGoals": "Refresh",
  "header.openGoalsOverview": "Open Overview",
  "header.resumeGoal": "Resume Goal",
  "header.automation": "Automation Settings",
  "header.selfdev": "Self-Dev Lab",
  "header.overnight": "Overnight Lab",
  "header.subagentType": "Type",
  "header.subagentModel": "Model",
  "header.subagentContinue": "Continue Session",
  "header.prompt": "Prompt",
  "header.question": "Question",
  "header.autoreview": "Auto Review",
  "header.autojudge": "Auto Judge",
  "header.cancel": "Cancel",
  "header.run": "Run",
  "header.ask": "Ask",
  "header.save": "Save",

  "sidePanel.aria": "Agent side panel",
  "sidePanel.source": "Source",

  "runtime.desktopBridgeUnavailable": "Lyra desktop bridge is unavailable.",
  "runtime.connecting": "Connecting",

  "scroll.toBottom": "Scroll to bottom",

  "decision.submit": "Submit",
  "decision.prev": "Previous",
  "decision.next": "Next",
  "decision.prevQuestion": "Previous question",
  "decision.nextQuestion": "Next question",
  "decision.custom": "Custom",
  "decision.customPlaceholder": "Type your answer",

  "permission.approve": "Allow",
  "permission.deny": "Deny",
  "permission.prev": "Previous permission request",
  "permission.next": "Next permission request",

  "todo.plan": "Execution plan",
  "todo.fallback": "Todo {index}",

  "diff.files": "files",

  "debug.title": "Debug",
  "debug.decisions": "Decisions panel",
  "debug.permission": "Permissions panel",

  "msg.copy": "Copy message",
  "msg.undo": "Undo",
  "msg.undoMessage": "Undo message",
  "msg.agentResponding": "Agent is responding",
  "msg.rollbackCancelRunning": "Cancel the running turn before rolling back.",
  "msg.rollbackUnavailable": "Rollback is unavailable for this message.",
  "msg.rollbackConfirm": "Confirm rollback",
  "msg.rollbackTitle": "Undo files and conversation",
  "msg.rollbackBody": "Return to before this message, removing {messages} messages and restoring {files} files.",
  "msg.rollbackMoreFiles": "+{count} more",
  "msg.rollbackCancel": "Cancel",
  "msg.rollbackBusy": "Undoing...",
  "msg.rollbackAction": "Undo",
  "msg.rollbackErrorTitle": "Cannot undo",
  "msg.rollbackClose": "Close",
  "msg.noResponseText": "No response text received.",
  "msg.turnFailedNoResponse": "The turn failed before a model response was received.",
  "msg.turnFailedWithReason": "The turn failed: {message}",
  "msg.imageAttachment": "Image attachment",
  "msg.browserScreenshot": "Browser screenshot",
  "msg.windowScreenshot": "Window screenshot",

  "working": "Working",

  "tool.ask.prefix": "Asked:",
  "tool.collapseGroup": "Collapse tool group",
  "tool.collapseCall": "Collapse tool call",
  "tool.collapseEditDetails": "Collapse edit details",
  "tool.agentActivity": "Agent activity",
  "tool.events": "{count} tool events",
  "tool.running": "Running...",
};

const DICTIONARIES: Record<Locale, Messages> = {
  "zh-CN": ZH_MESSAGES,
  "en-US": EN_MESSAGES,
};

let currentLocale: Locale = detectLocale();

function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-CN";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function t(key: AgentChatI18nKey): string {
  return DICTIONARIES[currentLocale][key];
}

export function formatMessage(
  key: AgentChatI18nKey,
  values: Readonly<Record<string, string | number>>
): string {
  return t(key).replace(/\{(\w+)\}/gu, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}
