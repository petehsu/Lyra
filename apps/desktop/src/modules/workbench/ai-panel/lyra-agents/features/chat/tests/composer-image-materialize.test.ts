import { describe, expect, test, vi } from "vitest";

import type { AgentImageAttachment } from "../../../core/types";
import {
  isDurableMessageImagePath,
  materializeComposerImageIfNeeded,
  persistComposerImageAttachment
} from "../composer-image";

describe("materializeComposerImageIfNeeded", () => {
  test("keeps openable path attachments unchanged", async () => {
    const image: AgentImageAttachment = {
      id: "img-1",
      mediaType: "image/png",
      data: "",
      source: "/Users/test/Desktop/shot.png",
      label: "shot.png"
    };
    const materialize = vi.fn();
    await expect(materializeComposerImageIfNeeded(image, materialize)).resolves.toEqual(image);
    expect(materialize).not.toHaveBeenCalled();
  });

  test("detects durable message image paths", () => {
    expect(isDurableMessageImagePath("/Users/test/.lyra/modules/agent/message-images/a.png"))
      .toBe(true);
    expect(isDurableMessageImagePath("/var/folders/tmp/Screenshot.png")).toBe(false);
  });

  test("materializes blob screenshots to a durable path", async () => {
    const image: AgentImageAttachment = {
      id: "dropped-image-test",
      mediaType: "image/png",
      data: "aGVsbG8=",
      source: "screenshot-drop",
      label: "Screenshot"
    };
    const materialize = vi.fn(async () => ({ path: "/tmp/lyra/message-images/test.png" }));
    await expect(materializeComposerImageIfNeeded(image, materialize)).resolves.toEqual({
      ...image,
      source: "/tmp/lyra/message-images/test.png",
      data: ""
    });
  });

  test("copies external file paths into durable message-images storage", async () => {
    const image: AgentImageAttachment = {
      id: "dropped-image-test",
      mediaType: "image/png",
      data: "",
      source: "/var/folders/xx/Screenshot.png",
      label: "Screenshot.png"
    };
    const materialize = vi.fn(async () => ({
      path: "/Users/test/.lyra/modules/agent/message-images/shot.png"
    }));
    const readSpy = vi.spyOn(
      await import("../read-image-attachment"),
      "readImageAttachmentFromPath"
    ).mockResolvedValue({
      id: "loaded",
      mediaType: "image/png",
      data: "aGVsbG8=",
      source: "/var/folders/xx/Screenshot.png",
      label: "Screenshot.png"
    });

    await expect(persistComposerImageAttachment(image, materialize)).resolves.toEqual({
      ...image,
      source: "/Users/test/.lyra/modules/agent/message-images/shot.png",
      data: ""
    });
    expect(readSpy).toHaveBeenCalledWith("/var/folders/xx/Screenshot.png");
    expect(materialize).toHaveBeenCalledWith({
      id: "dropped-image-test",
      mediaType: "image/png",
      data: "aGVsbG8=",
      label: "Screenshot.png"
    });
    readSpy.mockRestore();
  });
});