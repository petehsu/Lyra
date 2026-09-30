import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import {
  ProjectDirChip
} from "./ProjectDirChip";

describe("ProjectDirChip", () => {
  test("opens a new-project action when no session already has a project", async () => {
    const onChooseProject = vi.fn();
    const onSelectProject = vi.fn();
    const listProjects = vi.fn(async () => ({ projects: [] }));
    render(
      <ProjectDirChip
        desktopApi={{ agent: { listProjects } } as unknown as LyraDesktopApi}
        projectName={null}
        workingDir={null}
        isHome={true}
        canOpenProjectTree={false}
        onChooseProject={onChooseProject}
        onSelectProject={onSelectProject}
        onOpenProjectTree={async () => undefined}
        onOpenInFileManager={async () => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Home")).toHaveAttribute("title", "New project");
    });
    fireEvent.keyDown(screen.getByLabelText("Home"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "New project" }));
    expect(onChooseProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Choose project" })).not.toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  test("lists persisted projects in a submenu above new project", async () => {
    const onChooseProject = vi.fn();
    const onSelectProject = vi.fn();
    const listProjects = vi.fn(async () => ({ projects: [
      { id: "lyra", path: "/Users/petehsu/Documents/Lyra", name: "Lyra", available: true },
      { id: "other", path: "/Users/petehsu/Documents/Other", name: "Other", available: false }
    ] }));
    render(
      <ProjectDirChip
        desktopApi={{ agent: { listProjects } } as unknown as LyraDesktopApi}
        projectName={null}
        workingDir={null}
        isHome={true}
        canOpenProjectTree={false}
        onChooseProject={onChooseProject}
        onSelectProject={onSelectProject}
        onOpenProjectTree={async () => undefined}
        onOpenInFileManager={async () => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Home")).toHaveAttribute("title", "Choose project");
    });
    fireEvent.keyDown(screen.getByLabelText("Home"), { key: "ArrowDown" });
    const choose = await screen.findByRole("menuitem", { name: "Choose project" });
    expect(screen.getByRole("menuitem", { name: "New project" })).toBeInTheDocument();
    fireEvent.mouseEnter(choose);
    fireEvent.pointerMove(choose);
    choose.focus();
    fireEvent.keyDown(choose, { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Lyra ·/ }));
    expect(onSelectProject).toHaveBeenCalledWith("/Users/petehsu/Documents/Lyra");
    expect(onChooseProject).not.toHaveBeenCalled();
    expect(listProjects).toHaveBeenCalledWith();
  });
});
