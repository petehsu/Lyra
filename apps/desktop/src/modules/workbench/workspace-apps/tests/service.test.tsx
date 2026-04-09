import { describe, expect, test } from "vitest";

import {
  isAiHistoryAppId,
  isAiMcpAppId,
  isAiSkillsAppId,
  isFileEditorAppId,
  isFileManagerAppId,
  isNotificationCenterAppId,
  renderWorkspaceAppIcon
} from "../service";

describe("workspace app service", () => {
  test("type guards identify app ids", () => {
    expect(isFileManagerAppId("file-manager")).toBe(true);
    expect(isFileManagerAppId("file-editor")).toBe(false);
    expect(isFileEditorAppId("file-editor")).toBe(true);
    expect(isFileEditorAppId("file-manager")).toBe(false);
    expect(isAiMcpAppId("ai-mcp")).toBe(true);
    expect(isAiMcpAppId("ai-skills")).toBe(false);
    expect(isAiHistoryAppId("ai-history")).toBe(true);
    expect(isAiHistoryAppId("ai-mcp")).toBe(false);
    expect(isAiSkillsAppId("ai-skills")).toBe(true);
    expect(isAiSkillsAppId("ai-mcp")).toBe(false);
    expect(isNotificationCenterAppId("notification-center")).toBe(true);
    expect(isNotificationCenterAppId("ai-mcp")).toBe(false);
  });

  test("renders workspace app icon node", () => {
    const managerIcon = renderWorkspaceAppIcon("file-manager", "file-manager-home");
    const editorIcon = renderWorkspaceAppIcon("file-editor", "file-editor-code");
    const aiHistoryIcon = renderWorkspaceAppIcon("ai-history", "ai-panel-history");
    const aiMcpIcon = renderWorkspaceAppIcon("ai-mcp", "ai-panel-mcp");
    const aiSkillsIcon = renderWorkspaceAppIcon("ai-skills", "ai-panel-skills");
    const notificationIcon = renderWorkspaceAppIcon(
      "notification-center",
      "notification-center-default"
    );

    expect(managerIcon).toBeTruthy();
    expect(editorIcon).toBeTruthy();
    expect(aiHistoryIcon).toBeTruthy();
    expect(aiMcpIcon).toBeTruthy();
    expect(aiSkillsIcon).toBeTruthy();
    expect(notificationIcon).toBeTruthy();
  });
});
