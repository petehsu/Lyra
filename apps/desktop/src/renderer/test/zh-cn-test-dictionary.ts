// Test-only zh-CN dictionary used by the renderer test setup to emulate a
// managed language pack. The production app receives packs through
// lyraDesktop.i18n.readLanguageBundles(); vitest cannot, so the setup file
// serves this bundle instead. Only strings asserted by tests are listed —
// missing keys fall back to en-US.
export const TEST_ZH_CN_DICTIONARY: Record<string, string> = {
  "aiPanel.defaultSessionTitle": "新会话",
  "decision.sharedControl.question": "用户中断了 Lyra Agent 对当前浏览器标签的控制，现在由谁控制？",
  "header.newSession": "新会话",
  "header.more": "更多",
  "decision.sharedControl.detail": "检测到用户正在操作当前浏览器，Agent 控制已暂停。",
  "decision.sharedControl.continueAgent": "继续 Agent",
  "lyra-agents-composer.placeholder": "给Lyra发送消息",
  "lyra-agents-composer.modelControls": "模型控制",
  "lyra-agents-message.agentActivity": "Agent 活动",
  "lyra-agents-message.thinkingLabel": "思考中",
  "lyra-agents-message.thinkingInProgress": "思考中",
  "lyra-agents-message.processWorked": "已工作 {duration}",
  "lyra-agents-message.durationSeconds": "{count}秒",
  "lyra-agents-message.durationMinutes": "{count}分钟",
  "lyra-agents-message.durationHours": "{count}小时",
  "lyra-agents-message.durationDays": "{count}天",
  "lyra-agents-message.undoMessage": "撤回消息",
  "lyra-agents-message.rollbackTitle": "撤销文件和对话",
  "lyra-agents-message.rollbackBody": "将移除 {messages} 条消息并恢复 {files} 个文件。",
  "lyra-agents-message.rollbackConfirm": "确认回滚",
  "lyra-agents-message.rollbackCancel": "取消",
  "lyra-agents-message.rollbackBusy": "撤销中...",
  "lyra-agents-message.rollbackAction": "撤销",
  "lyra-agents-message.rollbackClose": "关闭",
  "tool.agentActivity": "Agent 活动"
};
