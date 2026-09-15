import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { resolveFileTypeIconId } from "@lyra/icons";

vi.mock("@lyra/icons/file-type", () => ({
  FileTypeIcon: ({ name }: { name?: string }) => <span data-file-type={name} />
}));

const rustEntry = {
  id: "main.rs",
  name: "main.rs",
  path: "/workspace/src/main.rs",
  kind: "file" as const,
  extension: "rs",
  isHidden: false
};

describe("file manager typed icons", () => {
  test("uses vscode-icons ids for rust, tsx, gitignore, and dockerfile", () => {
    expect(resolveFileTypeIconId("main.rs")).toBe("vscode-icons:file-type-rust");
    expect(resolveFileTypeIconId("app.tsx")).toBe("vscode-icons:file-type-reactts");
    expect(resolveFileTypeIconId(".gitignore")).toBe("vscode-icons:file-type-git");
    expect(resolveFileTypeIconId("Dockerfile")).toMatch(/^vscode-icons:file-type-docker/u);
  });

  test("does not render language letter badges", async () => {
    const { renderFileManagerEntryIcon } = await import("../icon-registry");
    const { container } = render(<>{renderFileManagerEntryIcon(rustEntry)}</>);
    expect(container.textContent ?? "").not.toContain("RS");
    expect(container.querySelector(".lyra-file-manager-icon-label")).toBeNull();
    expect(container.querySelector("[data-file-type='main.rs']")).not.toBeNull();
  });
});
