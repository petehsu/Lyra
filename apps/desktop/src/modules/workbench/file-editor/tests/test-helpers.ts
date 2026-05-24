import type {
  FileEditorAppState,
  FileEditorChangeReviewItem,
  FileEditorLabels
} from "../types";

export const labels: FileEditorLabels = {
  loading: "Loading",
  unsupported: "Unsupported",
  unavailable: "Unavailable",
  readOnly: "Read only",
  conflict: "Conflict",
  retry: "Retry",
  save: "Save",
  openDiff: "Open diff",
  closeDiff: "Close diff"
};

export const createFileEditorState = (
  overrides: Partial<FileEditorAppState> = {}
): FileEditorAppState => ({
  instanceId: "editor-1",
  sessionId: "session-1",
  filePath: "/workspace/app.ts",
  title: "app.ts",
  iconKey: "file-editor-code",
  status: "ready",
  languageId: "typescript",
  encoding: "utf8",
  content: "const value = 1;\n",
  lastSavedContent: "const value = 1;\n",
  isDirty: false,
  isReadOnly: false,
  isHydrated: true,
  revision: "1",
  sizeBytes: 16,
  unsupportedReason: undefined,
  message: undefined,
  lastSavedAt: undefined,
  lspVersion: 1,
  ...overrides
});

export const createReviewItem = (
  overrides: Partial<FileEditorChangeReviewItem> = {}
): FileEditorChangeReviewItem => ({
  id: "review-1",
  status: "completed",
  filePath: "/workspace/app.ts",
  addedLines: 2,
  removedLines: 1,
  createdAt: 1,
  baselineContent: "const value = 1;\n",
  ...overrides
});
