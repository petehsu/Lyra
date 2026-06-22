export const isInternalRuntimeFallbackText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return (
    /lyra native agent runtime is active/i.test(trimmed)
    || trimmed.includes("模型这次返回了空响应")
    || trimmed.includes("这轮对话没有完成")
    || /this turn did not complete/i.test(trimmed)
  );
};
