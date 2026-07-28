import { describe, expect, test, vi } from "vitest";

import {
  isLikelyScreenshotFilename,
  readImageAttachmentsFromDataTransfer
} from "../image-drop";

vi.mock("../electron-file-path", () => ({
  resolveElectronFilePath: (file: File) => {
    const named = file as File & { readonly __path?: string };
    return named.__path ?? null;
  }
}));

const createDataTransfer = (files: readonly File[]): DataTransfer => {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: files as unknown as FileList,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file
    })) as unknown as DataTransferItemList,
    types: files.length > 0 ? ["Files"] : [],
    clearData: () => {
      store.clear();
    },
    getData: (format: string) => store.get(format) ?? "",
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    setDragImage: () => undefined
  } as DataTransfer;
};

describe("image-drop", () => {
  test("detects common screenshot filenames", () => {
    expect(isLikelyScreenshotFilename("Screen Shot 2026-06-16 at 8.44.39 PM.png")).toBe(true);
    expect(isLikelyScreenshotFilename("截屏2026-06-16 20.44.39.png")).toBe(true);
    expect(isLikelyScreenshotFilename("notes.txt")).toBe(false);
  });

  test("uses path metadata for dropped files with a filesystem path", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    Object.assign(file, { __path: "/Users/test/Downloads/shot.png" });
    const attachments = await readImageAttachmentsFromDataTransfer(createDataTransfer([file]));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.source).toBe("/Users/test/Downloads/shot.png");
    expect(attachments[0]?.data).toBe("");
    expect(attachments[0]?.label).toBe("shot.png");
  });

  test("reads dropped image files into inline attachments", async () => {
    const pngBytes = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82
    ]);
    const file = new File([pngBytes], "Screen Shot.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => pngBytes.buffer
    });
    const attachments = await readImageAttachmentsFromDataTransfer(createDataTransfer([file]));
    expect(attachments).toHaveLength(1);
    const attachment = attachments[0];
    if (!attachment) {
      throw new Error("expected one image attachment");
    }
    expect(attachment.mediaType).toBe("image/png");
    expect(attachment.source).toBe("screenshot-drop");
    if (attachment.data === undefined) {
      throw new Error("expected inline image data");
    }
    expect(attachment.data.length).toBeGreaterThan(0);
  });
});
