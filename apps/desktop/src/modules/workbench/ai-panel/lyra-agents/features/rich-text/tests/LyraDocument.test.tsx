import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import * as shellService from "../../../../../shell/service";
import { LyraDocument } from "../LyraDocument";

const session: SessionMeta = {
  title: "Test",
  project: "Lyra",
  workingDir: "/tmp",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

describe("LyraDocument links", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("decorates final HTTP links with a known favicon and keeps Workbench navigation", async () => {
    const openUrlInWorkbench = vi.fn(async () => undefined);
    const content = [
      "[Example docs](https://example.com/docs)",
      "https://unknown.example/path"
    ].join(" ");
    const data = createDataProviderValue({
      session,
      messages: [],
      openUrlInWorkbench,
      workspaceTabs: [{
        id: "browser-tab-1",
        title: "Example",
        pageKind: "page",
        inputValue: "https://example.com/",
        displayAddress: "https://example.com/",
        faviconUrl: "lyra-file://preview?path=example.ico",
        query: undefined
      }]
    });

    const { container, rerender, unmount } = render(
      <DataContextProvider value={data}>
        <LyraDocument content={content} />
      </DataContextProvider>
    );

    const link = await screen.findByRole("link", { name: "Example docs" });
    expect(link).toHaveClass("lyra-agents-md-url-link");
    expect(link).toHaveAttribute("title", "https://example.com/docs");
    expect(link.querySelectorAll(".lyra-agents-md-url-link-label")).toHaveLength(1);
    await waitFor(() => {
      expect(link.querySelector("img")).toHaveAttribute(
        "src",
        "lyra-file://preview?path=example.ico"
      );
    });
    expect(screen.getByRole("link", {
      name: "https://unknown.example/path"
    }).querySelector("img")).toBeNull();

    fireEvent.click(link.querySelector("img") as HTMLImageElement);
    expect(openUrlInWorkbench).toHaveBeenCalledWith(
      "https://example.com/docs",
      "Example docs"
    );

    await act(async () => {
      rerender(
        <DataContextProvider value={{ ...data, workspaceTabs: [...data.workspaceTabs] }}>
          <LyraDocument content={content} />
        </DataContextProvider>
      );
      await Promise.resolve();
    });
    expect(screen.getByRole("link", { name: "Example docs" })).toBe(link);
    expect(container.querySelectorAll(".lyra-agents-md-url-link-label")).toHaveLength(2);
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
  });

  test("resolves an unopened website favicon without navigating to it", async () => {
    let finishResolve: ((result: { readonly iconUrl: string }) => void) | undefined;
    const resolveProviderIcon = vi.fn(() => new Promise<{ readonly iconUrl: string }>((resolve) => {
      finishResolve = resolve;
    }));
    vi.spyOn(shellService, "getDesktopApi").mockReturnValue({
      agent: { resolveProviderIcon }
    } as unknown as ReturnType<typeof shellService.getDesktopApi>);
    const data = createDataProviderValue({
      session,
      messages: [],
      workspaceTabs: []
    });

    const { unmount } = render(
      <DataContextProvider value={data}>
        <LyraDocument content="https://unopened.example/docs" />
      </DataContextProvider>
    );

    const link = await screen.findByRole("link", {
      name: "https://unopened.example/docs"
    });
    await waitFor(() => {
      expect(resolveProviderIcon).toHaveBeenCalledWith({
        baseUrl: "https://unopened.example",
        publicOnly: true
      });
    });
    await act(async () => {
      finishResolve?.({ iconUrl: "lyra-file://preview?path=resolved.ico" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(link.querySelector("img")).toHaveAttribute(
        "src",
        "lyra-file://preview?path=resolved.ico"
      );
    });
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
  });
});
