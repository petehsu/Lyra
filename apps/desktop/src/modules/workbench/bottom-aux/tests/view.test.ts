import { describe, expect, test } from "vitest";

import { AGENT_PROJECT_TREE_APP_ID } from "../../agent-project-tree";
import { resolveFindInFilesRoot } from "../view";
import type { WorkspaceTab } from "../workspace-tabs/types";

const tab = (
  overrides: Partial<WorkspaceTab> & Pick<WorkspaceTab, "id">
): WorkspaceTab => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  pageKind: overrides.pageKind ?? "app",
  inputValue: overrides.inputValue ?? "",
  displayAddress: overrides.displayAddress ?? "",
  faviconUrl: overrides.faviconUrl,
  query: overrides.query,
  appId: overrides.appId,
  appInstanceId: overrides.appInstanceId,
  ...overrides
});

describe("resolveFindInFilesRoot", () => {
  test("prefers the active project tree tab", () => {
    const active = tab({
      id: "tree-active",
      appId: AGENT_PROJECT_TREE_APP_ID,
      appInstanceId: "tree-2"
    });
    const root = resolveFindInFilesRoot(
      [
        tab({
          id: "tree-other",
          appId: AGENT_PROJECT_TREE_APP_ID,
          appInstanceId: "tree-1"
        }),
        active
      ],
      active,
      (instanceId) => instanceId === "tree-2" ? "/active" : "/other"
    );
    expect(root).toBe("/active");
  });

  test("falls back to any project tree tab", () => {
    const root = resolveFindInFilesRoot(
      [
        tab({ id: "browser", pageKind: "page" }),
        tab({
          id: "tree",
          appId: AGENT_PROJECT_TREE_APP_ID,
          appInstanceId: "tree-1"
        })
      ],
      undefined,
      (instanceId) => instanceId === "tree-1" ? "/project" : null
    );
    expect(root).toBe("/project");
  });
});
