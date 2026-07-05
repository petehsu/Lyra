// ponytail: file-editor surface — en-US 字典片段，按 key 前缀切割自原单文件
export const fileEditor = {
  "editor.loading": "Loading file",
  "editor.unsupported": "This file cannot be edited in Lyra yet.",
  "editor.unavailable": "File editor backend unavailable.",
  "editor.readOnly": "Read-only",
  "editor.conflict": "External change conflict",
  "editor.retry": "Retry",
  "editor.save": "Save",
  "editor.openDiff": "Open diff view",
  "editor.closeDiff": "Close diff view",
  "fileEditor.unsupportedVirtualToolPath": "This is a Lyra runtime tool path, not a local file.",
  "fileEditor.unsupportedNotFound": "The file does not exist or has not been created yet.",
  "fileEditor.unsupportedNotFile": "The current path is not an editable file.",
  "fileEditor.unsupportedFileTooLarge": "The file is too large and has been downgraded to read-only or non-editable.",
  "fileEditor.unsupportedEncodingNotSupported": "The current file encoding is not supported for editing.",
  "fileEditor.unsupportedDefault": "The current file type is not supported for editing.",
  "fileEditor.nativeCapabilityUnavailable": "File editor native capability is unavailable.",
} as const;
