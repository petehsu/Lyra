import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AgentApi } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { SettingsImportView, type SettingsImportLabels } from "./view";

const labels: SettingsImportLabels = {
  title: "Import Settings", description: "Sync settings", project: "Project directory",
  chooseProject: "Choose directory", clearProject: "Clear", detect: "Detect", sync: "Sync",
  synced: "Synced", needsAttention: "Needs attention", noContent: "Nothing to sync",
  skills: "Skills", mcp: "MCP", back: "Import Settings", loading: "Working", unavailable: "Unavailable"
};

const createApi = () => {
  const detectImport = vi.fn(async () => ({
    detectionId: "detection-1", sourceId: "claude" as const, projectRoot: null,
    counts: { pending: 2 }, diagnostics: [], candidates: [
      { kind: "skill" as const, scope: "user" as const, sourcePath: "/home/.claude/skills/demo", sourceItemId: "demo", targetId: "demo", status: "pending" as const, enabled: true },
      { kind: "mcp" as const, scope: "user" as const, sourcePath: "/home/.mcp.json", sourceItemId: "server", targetId: "server", status: "pending" as const, enabled: true }
    ]
  }));
  const agent = {
    listImportSources: vi.fn(async () => ({ sources: [
      { id: "claude" as const, label: "Claude", configPath: "/home/.claude" },
      { id: "cursor" as const, label: "Cursor", configPath: "/home/.cursor" },
      { id: "codex" as const, label: "Codex", configPath: "/home/.codex" },
      { id: "opencode" as const, label: "OpenCode", configPath: "/home/.config/opencode" },
      { id: "zed" as const, label: "Zed", configPath: "/home/.config/zed" }
    ] })),
    getImportPreferences: vi.fn(async () => ({ projectRoot: null, sources: { claude: { skills: true, mcp: true }, cursor: { skills: true, mcp: true }, codex: { skills: true, mcp: true }, opencode: { skills: true, mcp: true }, zed: { skills: true, mcp: true } } })),
    setImportPreferences: vi.fn(async () => ({ projectRoot: null, sources: { claude: { skills: true, mcp: true }, cursor: { skills: true, mcp: true }, codex: { skills: true, mcp: true }, opencode: { skills: true, mcp: true }, zed: { skills: true, mcp: true } } })),
    detectImport,
    syncImport: vi.fn(async () => ({ sourceId: "claude" as const, results: [], diagnostics: [] }))
  } as unknown as AgentApi;
  const desktopApi = { agent, files: { selectDirectories: vi.fn(async () => []) } } as unknown as LyraDesktopApi;
  return { agent, desktopApi, detectImport };
};

describe("SettingsImportView", () => {
  test("detects a visible source and exposes persisted kind toggles", async () => {
    const { desktopApi, detectImport } = createApi();
    render(<SettingsImportView desktopApi={desktopApi} labels={labels} />);

    const detectButtons = await screen.findAllByRole("button", { name: "Detect" });
    const [detect] = detectButtons;
    expect(detect).toBeDefined();
    expect(detectButtons).toHaveLength(5);
    for (const sourceId of ["claude", "cursor", "codex", "opencode", "zed"]) {
      expect(document.querySelector(`.lyra-settings-import-source-icon[src*="${sourceId}"]`))
        .toBeInTheDocument();
    }
    expect(document.querySelector(".lyra-settings-import"))
      .toHaveClass("lyra-settings-import");
    fireEvent.click(detect!);
    await waitFor(() => expect(detectImport).toHaveBeenCalledWith({ sourceId: "claude", projectRoot: null }));
    expect(await screen.findByRole("button", { name: "Sync" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Claude"));
    expect(screen.getByRole("switch", { name: "Skills" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "MCP" })).toBeChecked();
  });
});
