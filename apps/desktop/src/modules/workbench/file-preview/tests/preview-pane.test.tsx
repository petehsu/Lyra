import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FilePreviewPane } from "../preview-pane";

describe("FilePreviewPane", () => {
  test("zooms svg previews from the wheel without unmounting the image", () => {
    const { container } = render(
      <FilePreviewPane kind="svg" filePath="/project/logo.svg" content="" />
    );
    const stage = container.querySelector(".lyra-file-preview-image-stage");
    const image = container.querySelector(".lyra-file-preview-image");
    expect(stage).toBeInstanceOf(HTMLDivElement);
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(image).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });

    act(() => {
      stage?.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -120,
        bubbles: true,
        cancelable: true
      }));
    });

    expect(image).toHaveStyle({
      transform: `translate(0px, 0px) scale(${Math.exp(0.24)})`
    });
  });

  test("renders markdown through the shared document renderer", () => {
    const { container } = render(
      <FilePreviewPane
        kind="markdown"
        filePath="/project/readme.md"
        content={"# Title\n\n![square](https://example.com/square.png)"}
      />
    );

    expect(container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    expect(container.querySelector(".lyra-file-preview-markdown")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-side-flow")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});
