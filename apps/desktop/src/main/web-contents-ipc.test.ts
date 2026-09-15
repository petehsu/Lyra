import { describe, expect, test, vi } from "vitest";

import { sendToWebContents, sendToWindow, webContentsCanReceiveIpc } from "./web-contents-ipc";

const mockWebContents = (input: {
  readonly destroyed?: boolean;
  readonly frameDestroyed?: boolean;
  readonly mainFrameThrows?: boolean;
  readonly send?: ReturnType<typeof vi.fn>;
}) => {
  const send = input.send ?? vi.fn();
  return {
    isDestroyed: () => input.destroyed === true,
    mainFrame:
      input.mainFrameThrows === true
        ? undefined
        : {
            isDestroyed: () => input.frameDestroyed === true
          },
    send,
    get sendMock() {
      return send;
    }
  };
};

describe("webContentsCanReceiveIpc", () => {
  test("rejects a destroyed webContents", () => {
    expect(webContentsCanReceiveIpc(mockWebContents({ destroyed: true }) as never)).toBe(false);
  });

  test("rejects a disposed main frame", () => {
    expect(
      webContentsCanReceiveIpc(mockWebContents({ frameDestroyed: true }) as never)
    ).toBe(false);
  });

  test("accepts a live frame", () => {
    expect(webContentsCanReceiveIpc(mockWebContents({}) as never)).toBe(true);
  });
});

describe("sendToWebContents", () => {
  test("does not send when the frame is already disposed", () => {
    const webContents = mockWebContents({ frameDestroyed: true });
    expect(sendToWebContents(webContents as never, "channel", { ok: true })).toBe(false);
    expect(webContents.sendMock).not.toHaveBeenCalled();
  });

  test("swallows send throwing after a disposed-frame race", () => {
    const send = vi.fn(() => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    });
    const webContents = mockWebContents({ send });
    expect(sendToWebContents(webContents as never, "channel", { ok: true })).toBe(false);
  });
});

describe("sendToWindow", () => {
  test("skips a destroyed window", () => {
    expect(
      sendToWindow(
        { isDestroyed: () => true, webContents: mockWebContents({}) } as never,
        "channel"
      )
    ).toBe(false);
  });
});
