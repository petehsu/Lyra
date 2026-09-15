import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { setLocale } from "@workbench/i18n";
import { ChangedFilesCard } from "../ChangedFilesCard";
import { CHANGED_FILES_PREVIEW_LIMIT, type ChangedFile } from "../changed-files";

const file = (path: string, additions = 1, deletions = 0): ChangedFile => ({
  file: path,
  additions,
  deletions,
  hunks: [{ startLine: 1, lines: [{ kind: "add", text: `${path} line` }] }]
});

describe("ChangedFilesCard", () => {
  test("keeps only one file diff mounted", () => {
    setLocale("en-US");
    const { container } = render(
      <ChangedFilesCard files={[file("src/opencode.rs", 2, 0), file("src/state.rs", 3, 1)]} />
    );

    const rows = container.querySelectorAll(".lyra-agents-changed-files-row");
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    expect(container.querySelectorAll(".lyra-agents-changed-files-item.open")).toHaveLength(1);
    expect(container.querySelectorAll(".lyra-agents-changed-files-diff")).toHaveLength(1);
    expect(
      container.querySelector(".lyra-agents-changed-files-item.open .lyra-agents-changed-files-filename")
        ?.textContent
    ).toBe("state.rs");
  });

  test("keeps every file in the snapped list without a more button", () => {
    setLocale("en-US");
    const files = Array.from({ length: 7 }, (_, index) => file(`src/file-${index}.ts`));
    const { container } = render(<ChangedFilesCard files={files} />);

    expect(screen.getByText("7 Changed files")).toBeInTheDocument();
    expect(container.querySelectorAll(".lyra-agents-changed-files-row")).toHaveLength(7);
    expect(screen.getByText("file-6.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\+1 more files/u })).toBeNull();
    expect(container.querySelector(".lyra-agents-changed-files-list")).toHaveStyle({
      maxHeight: `calc(${CHANGED_FILES_PREVIEW_LIMIT} * var(--lyra-agents-changed-files-row-height))`
    });
  });
});
