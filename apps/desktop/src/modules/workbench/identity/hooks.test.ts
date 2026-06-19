import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { LyraDesktopApi, ProjectIdentitySnapshot } from "../../../shared/desktop-bridge";
import { iconFromProject, useTerminalIdentityMap } from "./hooks";

const project = (overrides: Partial<ProjectIdentitySnapshot>): ProjectIdentitySnapshot => ({
  rootPath: "/tmp/project",
  name: "project",
  logo: {
    url: "lyra-file://preview?path=%2Ftmp%2Fproject%2Flogo.svg&contentType=image%2Fsvg%2Bxml",
    source: "project",
    path: "/tmp/project/logo.svg"
  },
  ...overrides
});

describe("identity icon projection", () => {
  test("renders generic project logos as image previews", () => {
    expect(iconFromProject(project({}))?.url).toContain("lyra-file://preview");
    expect(iconFromProject(project({}))?.renderHint).toBeUndefined();
  });

  test("renders nested Lyra renderer logos with the theme-aware Lyra mark", () => {
    const icon = iconFromProject(project({
      rootPath: "/Users/petehsu/Documents/Lyra/apps/desktop",
      name: "desktop",
      logo: {
        url: "lyra-file://preview?path=%2FUsers%2Fpetehsu%2FDocuments%2FLyra%2Fapps%2Fdesktop%2Fsrc%2Frenderer%2Fassets%2Flogo.svg&contentType=image%2Fsvg%2Bxml",
        source: "project",
        path: "/Users/petehsu/Documents/Lyra/apps/desktop/src/renderer/assets/logo.svg"
      }
    }));

    expect(icon).toMatchObject({
      url: null,
      source: "project",
      renderHint: "lyra-logo"
    });
  });

  test("uses the theme-aware Lyra mark when terminal tabs inherit a Lyra source session icon", async () => {
    const api = {
      identity: {
        readUserIcon: async () => null,
        resolveProjectIdentity: async ({ path }) => {
          if (path !== "/Users/petehsu/Documents/Lyra/apps/desktop") {
            return null;
          }
          return project({
            rootPath: "/Users/petehsu/Documents/Lyra/apps/desktop",
            name: "desktop",
            logo: {
              url: "lyra-file://preview?path=%2FUsers%2Fpetehsu%2FDocuments%2FLyra%2Fapps%2Fdesktop%2Fsrc%2Frenderer%2Fassets%2Flogo.svg&contentType=image%2Fsvg%2Bxml",
              source: "project",
              path: "/Users/petehsu/Documents/Lyra/apps/desktop/src/renderer/assets/logo.svg"
            }
          });
        }
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useTerminalIdentityMap(api, [{
        terminalTabId: "terminal-1",
        currentCwd: "/Users/petehsu",
        sourceAgentWorkingDir: "/Users/petehsu/Documents/Lyra/apps/desktop"
      }])
    );

    await waitFor(() => {
      expect(result.current["terminal-1"]).toMatchObject({
        url: null,
        source: "project",
        renderHint: "lyra-logo"
      });
    });
  });
});
