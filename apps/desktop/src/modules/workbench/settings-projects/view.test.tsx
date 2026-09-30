import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AgentRuntimeEvent } from "../../../shared/agent";
import type { AgentProjectSettings } from "../../../shared/agent-projects";
import { SettingsProjectsView } from "./view";

const setup = () => {
  const listeners = new Set<(event: AgentRuntimeEvent) => void>();
  const project = { id: "p", path: "/work/demo", name: "Demo", available: true, lastUsedAt: "2026-01-01" };
  let detail: AgentProjectSettings = { project, mcp: [{ id: "m", name: "Local MCP", description: "node server.js", enabled: true, globalEnabled: true, override: null }], skills: [{ id: "s", name: "Review", description: "Review changes", enabled: false, globalEnabled: false, override: null }] };
  const listProjects = vi.fn(async () => ({ projects: [project] }));
  const getProjectSettings = vi.fn(async () => detail);
  const setProjectOverride = vi.fn(async (request: { kind: "mcp" | "skill"; enabled: boolean | null }) => {
    const key = request.kind === "mcp" ? "mcp" : "skills";
    detail = { ...detail, [key]: detail[key].map((item) => ({ ...item, override: request.enabled, enabled: request.enabled ?? item.globalEnabled })) };
    listeners.forEach((listener) => listener({ kind: "projectCapabilitiesChanged" }));
    return detail;
  });
  const agent = { listProjects, getProjectSettings, setProjectOverride, onEvent: (listener: (event: AgentRuntimeEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  return { api: { agent } as unknown as LyraDesktopApi, agent, listeners };
};

describe("project settings", () => {
  test("uses persisted projects, defaults to MCP, saves overrides and restores global policy", async () => {
    const { api, agent } = setup();
    render(<SettingsProjectsView desktopApi={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Demo" }));
    const mcp = await screen.findByRole("switch", { name: "Local MCP" });
    expect(mcp).toBeChecked();
    fireEvent.click(mcp);
    await waitFor(() => expect(mcp).not.toBeChecked());
    expect(agent.setProjectOverride).toHaveBeenLastCalledWith({ projectId: "p", kind: "mcp", itemId: "m", enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Restore global default" }));
    await waitFor(() => expect(mcp).toBeChecked());
    expect(agent.setProjectOverride).toHaveBeenLastCalledWith({ projectId: "p", kind: "mcp", itemId: "m", enabled: null });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skill" }), { button: 0, ctrlKey: false });
    const skill = await screen.findByRole("switch", { name: "Review" });
    expect(skill).not.toBeChecked();
    fireEvent.click(skill);
    await waitFor(() => expect(skill).toBeChecked());
    expect(screen.queryByRole("button", { name: /install|uninstall|edit/i })).not.toBeInTheDocument();
  });

  test("failed saves retain server value and show the error", async () => {
    const { api, agent } = setup();
    agent.setProjectOverride.mockRejectedValueOnce(new Error("Disk full"));
    render(<SettingsProjectsView desktopApi={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Demo" }));
    const toggle = await screen.findByRole("switch", { name: "Local MCP" });
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
    await waitFor(() => expect(toggle).toBeChecked());
  });

  test("a draft registration notification refreshes the same list", async () => {
    const { api, agent, listeners } = setup();
    agent.listProjects.mockResolvedValueOnce({ projects: [] });
    render(<SettingsProjectsView desktopApi={api} />);
    await screen.findByText("Projects selected in a conversation appear here.");
    act(() => listeners.forEach((listener) => listener({ kind: "projectCapabilitiesChanged" })));
    expect(await screen.findByRole("button", { name: "Demo" })).toBeInTheDocument();
  });
});
