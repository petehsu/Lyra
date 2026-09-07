import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { DownloadManagerSettings } from "../../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { SettingsDownloadsLabels } from "../types";
import { SettingsDownloadsView } from "../view";

const labels: SettingsDownloadsLabels = {
  title: "Downloads",
  unavailable: "Download settings unavailable",
  defaultDirectory: "Default save directory",
  defaultDirectorySystem: "System default",
  chooseDirectory: "Choose directory",
  proxySection: "Proxy",
  proxyMode: "Proxy mode",
  proxyModeSystem: "System",
  proxyModeDirect: "Direct",
  proxyModeHttp: "HTTP",
  proxyModeSocks5: "SOCKS5",
  proxyUrl: "Proxy URL",
  proxyUrlPlaceholder: "http://",
  btSection: "BitTorrent",
  btDht: "DHT",
  btPeerExchange: "Peer exchange (PEX)",
  btLocalPeerDiscovery: "Local peer discovery",
  btSeedTime: "Seed time (minutes)",
  btTrackers: "Trackers",
  btTrackersPlaceholder: "One tracker URL per line"
};

const createSettings = (): DownloadManagerSettings => ({
  version: 1,
  speedLimitBytesPerSecond: 1_048_576,
  proxy: { mode: "direct" },
  bt: {
    dhtEnabled: true,
    peerExchangeEnabled: true,
    localPeerDiscoveryEnabled: false,
    seedTimeMinutes: 30,
    trackerUrls: ["udp://tracker.example.test/announce"],
    maxUploadBytesPerSecond: null
  },
  defaultHeaders: {},
  defaultCookieHeader: null,
  maxConcurrentDownloads: 3,
  defaultDirectory: "/tmp/downloads",
  updatedAt: "2026-09-06T00:00:00.000Z"
});

const createDesktopApi = (
  settings: DownloadManagerSettings,
  updateSettings = vi.fn(async (request: Partial<DownloadManagerSettings>) => ({
    ...settings,
    ...request
  }))
): { api: LyraDesktopApi; updateSettings: ReturnType<typeof vi.fn> } => ({
  api: {
    downloads: {
      readSettings: vi.fn(async () => settings),
      updateSettings
    }
  } as unknown as LyraDesktopApi,
  updateSettings
});

describe("SettingsDownloadsView", () => {
  test("renders current download settings", async () => {
    const { api } = createDesktopApi(createSettings());
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={vi.fn().mockResolvedValue(null)}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("/tmp/downloads")).toBeInTheDocument()
    );
    expect(screen.getByLabelText("Seed time (minutes)")).toHaveValue("30");
    expect(screen.getByLabelText("Trackers")).toHaveValue("udp://tracker.example.test/announce");
    expect(screen.getByRole("switch", { name: "DHT" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Local peer discovery" })).not.toBeChecked();
    expect(screen.queryByLabelText("Proxy URL")).toBeNull();
  });

  test("shows the system default placeholder when no directory is set", async () => {
    const settings: DownloadManagerSettings = {
      ...createSettings(),
      defaultDirectory: null
    };
    const { api } = createDesktopApi(settings);
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={vi.fn().mockResolvedValue(null)}
      />
    );

    await waitFor(() => expect(screen.getByText("System default")).toBeInTheDocument());
  });

  test("shows the proxy url row only for explicit proxy modes", async () => {
    const settings = createSettings();
    const httpSettings: DownloadManagerSettings = {
      ...settings,
      proxy: { mode: "http", url: "http://proxy.example.test:8080" }
    };
    const { api } = createDesktopApi(httpSettings);
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={vi.fn().mockResolvedValue(null)}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Proxy URL")).toHaveValue(
      "http://proxy.example.test:8080"
    ));
  });

  test("updates the default directory through the directory chooser", async () => {
    const { api, updateSettings } = createDesktopApi(createSettings());
    const onChooseDirectory = vi.fn().mockResolvedValue("/tmp/other");
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={onChooseDirectory}
      />
    );

    await waitFor(() => expect(screen.getByText("/tmp/downloads")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Choose directory" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({ defaultDirectory: "/tmp/other" })
    );
  });

  test("keeps the current directory when the chooser returns null", async () => {
    const { api, updateSettings } = createDesktopApi(createSettings());
    const onChooseDirectory = vi.fn().mockResolvedValue(null);
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={onChooseDirectory}
      />
    );

    await waitFor(() => expect(screen.getByText("/tmp/downloads")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Choose directory" }));
    await waitFor(() => expect(onChooseDirectory).toHaveBeenCalled());
    expect(updateSettings).not.toHaveBeenCalled();
  });

  test("routes bt switches and tracker edits through updateSettings", async () => {
    const { api, updateSettings } = createDesktopApi(createSettings());
    render(
      <SettingsDownloadsView
        desktopApi={api}
        labels={labels}
        onChooseDirectory={vi.fn().mockResolvedValue(null)}
      />
    );

    await waitFor(() => expect(screen.getByRole("switch", { name: "DHT" })).toBeChecked());

    fireEvent.click(screen.getByRole("switch", { name: "Local peer discovery" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({
        bt: expect.objectContaining({ localPeerDiscoveryEnabled: true })
      })
    );

    fireEvent.change(screen.getByLabelText("Trackers"), {
      target: { value: "udp://a.example.test\nudp://b.example.test" }
    });
    fireEvent.blur(screen.getByLabelText("Trackers"));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({
        bt: expect.objectContaining({
          trackerUrls: ["udp://a.example.test", "udp://b.example.test"]
        })
      })
    );
  });

  test("renders the unavailable state when the downloads api is missing", () => {
    render(
      <SettingsDownloadsView
        desktopApi={null}
        labels={labels}
        onChooseDirectory={vi.fn().mockResolvedValue(null)}
      />
    );

    expect(screen.getByText("Download settings unavailable")).toBeInTheDocument();
  });
});