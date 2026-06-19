// ============================================================================
// Lyra Agents — Internationalization
// ============================================================================

export type Locale = "zh-CN" | "en-US";

const ZH_MESSAGES = {
  "lyra-agents-app.title": "Lyra Agents",
  "lyra-agents-app.tagline": "Lyra 智能体工作区",

  "lyra-agents-composer.placeholder": "给Lyra发送消息",
  "lyra-agents-composer.send": "发送",
  "lyra-agents-composer.pause": "暂停",
  "lyra-agents-composer.followAgent": "跟随 Agent",
  "lyra-agents-composer.stopFollowingAgent": "停止跟随 Agent",
  "lyra-agents-composer.attach": "附件",
  "lyra-agents-composer.poke": "继续未完成事项",
  "lyra-agents-composer.modelControls": "模型控制",
  "lyra-agents-composer.modelList": "模型列表",
  "lyra-agents-composer.permissionMode": "权限模式",
  "lyra-agents-composer.permissionModeList": "权限模式列表",
  "lyra-agents-composer.permissionModeApproval": "审批",
  "lyra-agents-composer.permissionModeFullAuto": "全自动",
  "lyra-agents-composer.permissionModeCustom": "自定义",
  "lyra-agents-composer.configureModel": "配置模型",
  "lyra-agents-composer.answerClarificationFirst": "请先回答上方问题",
  "lyra-agents-composer.reasoningEffort": "推理强度",
  "lyra-agents-composer.verbosity": "详略程度",
  "lyra-agents-composer.fastMode": "高速模式",
  "lyra-agents-composer.serviceTierStandard": "标准",
  "lyra-agents-composer.attachImage": "添加图片",
  "lyra-agents-composer.attachFile": "添加文件",
  "lyra-agents-composer.attachWorkspaceTab": "添加工作区标签",
  "lyra-agents-composer.attachTerminalTab": "添加终端标签",
  "lyra-agents-composer.attachWorkspaceScreenshot": "工作区截图",
  "lyra-agents-composer.attachWindowScreenshot": "窗口截图",
  "lyra-agents-composer.fileChip": "文件：{preview}",
  "lyra-agents-composer.imageChipFile": "图片附件：{preview}",
  "lyra-agents-composer.imageChipWorkspace": "工作区截图：{preview}",
  "lyra-agents-composer.imageChipWindow": "窗口截图：{preview}",
  "lyra-agents-composer.removeAttachment": "移除附件",
  "lyra-agents-composer.dragAttachRelease": "松手添加",
  "lyra-agents-composer.workingDirHome": "Home",

  "lyra-agents-empty.questionPrefix": "想要在 ",
  "lyra-agents-empty.questionSuffix": " 中做什么？",

  "header.more": "更多",
  "header.moreDisabled": "空会话暂无可用操作",
  "header.openProjectTree": "打开项目文件树",
  "header.cancelTurn": "取消当前回复",
  "header.newSession": "新建会话",
  "header.followAgent": "跟随 Agent",
  "header.stopFollowingAgent": "停止跟随 Agent",
  "header.improve": "改进",
  "header.refactor": "重构",
  "header.review": "代码审查",
  "header.judge": "验收检查",
  "header.rename": "重命名",
  "header.archive": "归档",
  "header.delete": "删除",
  "header.renameTitle": "重命名会话",
  "header.renamePlaceholder": "输入会话名称",
  "header.saveRename": "保存",
  "header.clearRename": "清除自定义名称",
  "header.deleteConfirmTitle": "永久删除此会话？",
  "header.deleteConfirmDescription": "删除后无法恢复。",
  "header.deleteConfirmAction": "永久删除",
  "header.cancelAction": "取消",

  "runtime.desktopBridgeUnavailable": "Lyra 桌面桥接不可用。",

  "permissionPolicy.fullAutoWarningTitle": "开启全自动模式",
  "permissionPolicy.fullAutoWarningDescription": "全自动模式会让 Lyra Agent 在本机会话中跳过逐项审批，直接执行它认为必要的操作。Lyra 能读写项目文件、运行命令、操作浏览器页面、调用已授权账号，也可能调度系统能力、项目代码与外部设备；这正是它强大的地方，也意味着误用时风险真实存在。若你不清楚此模式的含义，请不要开启。请只在你信任当前任务、工作区和模型输出时继续。",
  "permissionPolicy.dialogSourceSubtitle": "权限模式",
  "permissionPolicy.cancel": "取消",
  "permissionPolicy.continue": "继续",
  "permissionPolicy.adminCredentialTitle": "保存管理员凭据",
  "permissionPolicy.adminCredentialDescription": "为了确认操作者身份，并在需要时为受保护的本机操作提供凭据，请输入本机管理员密码。密码会加密保存为 Lyra 敏感值引用；模型只能看到不可读引用，不能读取明文。",
  "permissionPolicy.sensitiveValueSubtitle": "本机敏感值",
  "permissionPolicy.adminPasswordLabel": "管理员密码",
  "permissionPolicy.saveAndEnable": "保存并开启",
  "permissionPolicy.adminCredentialLabel": "Lyra Agent 管理员凭据",
  "permissionPolicy.adminCredentialStorageDescription": "Lyra Agent 全自动模式的持久管理员凭据。",

  "scroll.toBottom": "回到底部",
  "scroll.previousMessage": "上一条",
  "scroll.jumpToPreviousMessage": "定位到上一条消息",

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

  "debug.title": "调试面板",
  "debug.decisions": "提问面板",
  "debug.permission": "权限申请面板",

  "lyra-agents-message.copy": "复制消息",
  "lyra-agents-message.undo": "撤回",
  "lyra-agents-message.undoMessage": "撤回消息",
  "lyra-agents-message.agentResponding": "Agent 正在回复",
  "lyra-agents-message.rollbackCancelRunning": "请先取消当前回复，再执行回退。",
  "lyra-agents-message.rollbackUnavailable": "这条消息不可回退。",
  "lyra-agents-message.rollbackConfirm": "确认回退",
  "lyra-agents-message.rollbackTitle": "撤销文件和对话",
  "lyra-agents-message.rollbackBody": "回到这条消息发送前，将移除 {messages} 条消息并恢复 {files} 个文件。",
  "lyra-agents-message.rollbackMoreFiles": "+{count} 个更多文件",
  "lyra-agents-message.rollbackCancel": "取消",
  "lyra-agents-message.rollbackBusy": "正在撤销...",
  "lyra-agents-message.rollbackAction": "撤销",
  "lyra-agents-message.rollbackErrorTitle": "无法撤销",
  "lyra-agents-message.rollbackClose": "关闭",

  "lyra-agents-turnFailure.generic": "这轮对话没有完成，你可以重新发送消息。",
  "lyra-agents-turnFailure.emptyResponse": "模型没有返回有效内容，请再试一次或换个模型。",
  "lyra-agents-turnFailure.timeout": "模型响应超时，请稍后再试。",
  "lyra-agents-turnFailure.providerAuth": "模型服务认证失败，请检查 API 配置。",
  "lyra-agents-turnFailure.contextLength": "对话上下文过长，请新建会话或缩短历史消息后重试。",
  "lyra-agents-turnFailure.cancelled": "这轮对话已取消。",
  "lyra-agents-message.imageAttachment": "图片附件",
  "lyra-agents-message.workspaceScreenshot": "工作区截图",
  "lyra-agents-message.windowScreenshot": "窗口截图",
  "lyra-agents-message.cite": "引用",
  "lyra-agents-message.citeMessage": "引用整条消息",
  "lyra-agents-message.citeSelection": "引用选中内容",

  "lyra-agents-citation.chipLabel": "{role}：{preview}",
  "lyra-agents-citation.roleUser": "用户",
  "lyra-agents-citation.roleAgent": "Agent",
  "lyra-agents-citation.jumpToSource": "跳转到引用来源",
  "lyra-agents-page-citation.chipLabel": "{tab}：{preview}",

  "tool.collapseGroup": "收起工具组",
    "tool.collapseCall": "收起工具调用",
  "tool.collapseEditDetails": "收起编辑详情",
  "tool.agentActivity": "Agent 活动",
  "tool.events": "{count} 个工具事件",
  "tool.running": "运行中...",
  "tool.streamingDiff": "正在生成变更...",
} as const;

export type AgentChatI18nKey = keyof typeof ZH_MESSAGES;
type Messages = Record<AgentChatI18nKey, string>;

const EN_MESSAGES: Messages = {
  "lyra-agents-app.title": "Lyra Agents",
  "lyra-agents-app.tagline": "Lyra agent workspace",

  "lyra-agents-composer.placeholder": "Send a message to Lyra",
  "lyra-agents-composer.send": "Send",
  "lyra-agents-composer.pause": "Pause",
  "lyra-agents-composer.followAgent": "Follow Agent",
  "lyra-agents-composer.stopFollowingAgent": "Stop Following Agent",
  "lyra-agents-composer.attach": "Attach",
  "lyra-agents-composer.poke": "Continue unfinished todos",
  "lyra-agents-composer.modelControls": "Model controls",
  "lyra-agents-composer.modelList": "Model list",
  "lyra-agents-composer.permissionMode": "Permission mode",
  "lyra-agents-composer.permissionModeList": "Permission mode list",
  "lyra-agents-composer.permissionModeApproval": "Approval",
  "lyra-agents-composer.permissionModeFullAuto": "Full auto",
  "lyra-agents-composer.permissionModeCustom": "Custom",
  "lyra-agents-composer.configureModel": "Configure model",
  "lyra-agents-composer.answerClarificationFirst": "Answer the question above first",
  "lyra-agents-composer.reasoningEffort": "Reasoning effort",
  "lyra-agents-composer.verbosity": "Verbosity",
  "lyra-agents-composer.fastMode": "Fast mode",
  "lyra-agents-composer.serviceTierStandard": "standard",
  "lyra-agents-composer.attachImage": "Add image",
  "lyra-agents-composer.attachFile": "Add file",
  "lyra-agents-composer.attachWorkspaceTab": "Add workspace tab",
  "lyra-agents-composer.attachTerminalTab": "Add terminal tab",
  "lyra-agents-composer.attachWorkspaceScreenshot": "Workspace screenshot",
  "lyra-agents-composer.attachWindowScreenshot": "Window screenshot",
  "lyra-agents-composer.fileChip": "File: {preview}",
  "lyra-agents-composer.imageChipFile": "Image attachment: {preview}",
  "lyra-agents-composer.imageChipWorkspace": "Workspace screenshot: {preview}",
  "lyra-agents-composer.imageChipWindow": "Window screenshot: {preview}",
  "lyra-agents-composer.removeAttachment": "Remove attachment",
  "lyra-agents-composer.dragAttachRelease": "Release to attach",
  "lyra-agents-composer.workingDirHome": "Home",

  "lyra-agents-empty.questionPrefix": "What would you like to do in ",
  "lyra-agents-empty.questionSuffix": "?",

  "header.more": "More",
  "header.moreDisabled": "No actions for an empty session",
  "header.openProjectTree": "Open Project Tree",
  "header.cancelTurn": "Cancel turn",
  "header.newSession": "New session",
  "header.followAgent": "Follow Agent",
  "header.stopFollowingAgent": "Stop Following Agent",
  "header.improve": "Improve",
  "header.refactor": "Refactor",
  "header.review": "Code review",
  "header.judge": "Acceptance check",
  "header.rename": "Rename",
  "header.archive": "Archive",
  "header.delete": "Delete",
  "header.renameTitle": "Rename session",
  "header.renamePlaceholder": "Enter a session name",
  "header.saveRename": "Save",
  "header.clearRename": "Clear custom name",
  "header.deleteConfirmTitle": "Delete session permanently?",
  "header.deleteConfirmDescription": "This cannot be restored.",
  "header.deleteConfirmAction": "Delete permanently",
  "header.cancelAction": "Cancel",

  "runtime.desktopBridgeUnavailable": "Lyra desktop bridge is unavailable.",

  "permissionPolicy.fullAutoWarningTitle": "Enable full auto mode",
  "permissionPolicy.fullAutoWarningDescription": "Full auto mode lets Lyra Agent skip per-action approvals in this local session and directly run the operations it decides are needed. Lyra can read and write project files, run commands, operate browser pages, use authorized accounts, and may coordinate system capabilities, project code, and external devices. That is part of its power, and it also makes misuse genuinely risky. If you do not understand this mode, do not enable it. Continue only when you trust the current task, workspace, and model output.",
  "permissionPolicy.dialogSourceSubtitle": "Permission mode",
  "permissionPolicy.cancel": "Cancel",
  "permissionPolicy.continue": "Continue",
  "permissionPolicy.adminCredentialTitle": "Save administrator credential",
  "permissionPolicy.adminCredentialDescription": "To confirm operator identity and provide credentials for protected local operations when needed, enter the local administrator password. The password is saved as an encrypted Lyra sensitive value reference; the model can only see an unreadable reference and cannot read the plaintext.",
  "permissionPolicy.sensitiveValueSubtitle": "Local sensitive value",
  "permissionPolicy.adminPasswordLabel": "Administrator password",
  "permissionPolicy.saveAndEnable": "Save and enable",
  "permissionPolicy.adminCredentialLabel": "Lyra Agent administrator credential",
  "permissionPolicy.adminCredentialStorageDescription": "Persistent administrator credential for Lyra Agent full auto mode.",

  "scroll.toBottom": "Scroll to bottom",
  "scroll.previousMessage": "Previous",
  "scroll.jumpToPreviousMessage": "Jump to previous message",

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

  "debug.title": "Debug",
  "debug.decisions": "Decisions panel",
  "debug.permission": "Permissions panel",

  "lyra-agents-message.copy": "Copy message",
  "lyra-agents-message.undo": "Undo",
  "lyra-agents-message.undoMessage": "Undo message",
  "lyra-agents-message.agentResponding": "Agent is responding",
  "lyra-agents-message.rollbackCancelRunning": "Cancel the running turn before rolling back.",
  "lyra-agents-message.rollbackUnavailable": "Rollback is unavailable for this message.",
  "lyra-agents-message.rollbackConfirm": "Confirm rollback",
  "lyra-agents-message.rollbackTitle": "Undo files and conversation",
  "lyra-agents-message.rollbackBody": "Return to before this message, removing {messages} messages and restoring {files} files.",
  "lyra-agents-message.rollbackMoreFiles": "+{count} more",
  "lyra-agents-message.rollbackCancel": "Cancel",
  "lyra-agents-message.rollbackBusy": "Undoing...",
  "lyra-agents-message.rollbackAction": "Undo",
  "lyra-agents-message.rollbackErrorTitle": "Cannot undo",
  "lyra-agents-message.rollbackClose": "Close",

  "lyra-agents-turnFailure.generic": "This turn did not complete. You can send your message again.",
  "lyra-agents-turnFailure.emptyResponse": "The model returned no usable response. Try again or switch models.",
  "lyra-agents-turnFailure.timeout": "The model timed out. Try again in a moment.",
  "lyra-agents-turnFailure.providerAuth": "Model provider authentication failed. Check your API configuration.",
  "lyra-agents-turnFailure.contextLength": "The conversation context is too long. Start a new session or shorten history.",
  "lyra-agents-turnFailure.cancelled": "This turn was cancelled.",
  "lyra-agents-message.imageAttachment": "Image attachment",
  "lyra-agents-message.workspaceScreenshot": "Workspace screenshot",
  "lyra-agents-message.windowScreenshot": "Window screenshot",
  "lyra-agents-message.cite": "Cite",
  "lyra-agents-message.citeMessage": "Cite entire message",
  "lyra-agents-message.citeSelection": "Cite selection",

  "lyra-agents-citation.chipLabel": "{role}: {preview}",
  "lyra-agents-citation.roleUser": "User",
  "lyra-agents-citation.roleAgent": "Agent",
  "lyra-agents-citation.jumpToSource": "Jump to citation source",
  "lyra-agents-page-citation.chipLabel": "{tab}: {preview}",

  "tool.collapseGroup": "Collapse tool group",
  "tool.collapseCall": "Collapse tool call",
  "tool.collapseEditDetails": "Collapse edit details",
  "tool.agentActivity": "Agent activity",
  "tool.events": "{count} tool events",
  "tool.running": "Running...",
  "tool.streamingDiff": "Streaming changes...",
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
