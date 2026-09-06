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
  "decision.auth.visible.question": "可见浏览器页面正在等待你完成身份验证。",
  "decision.auth.isolated.question": "身份验证需要在可见浏览器页面中完成。",
  "decision.auth.complete.question": "请在可见页面完成身份步骤，Lyra 会自动验证并继续。",
  "decision.auth.detail": "Lyra 只暂停受阻的浏览器操作，其他自主工作可以继续。",
  "decision.auth.userBoundary.detail": "密码、多重验证、验证码、Passkey、账号选择和最终授权仍由你控制。",
  "decision.auth.resume": "验证后继续",
  "decision.auth.resume.description": "验证当前页面并自动继续。",
  "decision.auth.openVisible": "打开可见页面",
  "decision.auth.openVisible.description": "打开可见页面完成身份步骤，随后自动继续。",
  "decision.auth.cancelTask": "取消任务",
  "decision.auth.cancelTask.description": "取消这个浏览器任务。",
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
  "tool.agentActivity": "Agent 活动",
  "tool.waitingForUserAction": "正在等待用户操作"
};
