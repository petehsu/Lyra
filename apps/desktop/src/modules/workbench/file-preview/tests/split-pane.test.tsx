import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FilePreviewSplit } from "../split-pane";

describe("FilePreviewSplit", () => {
  test("keeps the source node mounted when switching layout to preview-only", () => {
    const source = <div data-testid="source-host" />;
    const preview = <div data-testid="preview-host" />;
    const { rerender } = render(
      <FilePreviewSplit
        layout="source"
        source={source}
        preview={preview}
        resizerLabel="View mode"
      />
    );
    const host = screen.getByTestId("source-host");

    rerender(
      <FilePreviewSplit
        layout="preview"
        source={source}
        preview={preview}
        resizerLabel="View mode"
      />
    );

    expect(screen.getByTestId("source-host")).toBe(host);
    expect(screen.getByTestId("preview-host")).toBeTruthy();
  });
});
