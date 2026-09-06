import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { DownloadManagerSettings } from "../../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { SettingsDownloadsLabels } from "../types";
import { SettingsDownloadsView } from "../view";

const labels: SettingsDownloadsLabels = {
  title: "Downloads",
  unavailable: "Download settings unavailable",
  speedLimit: "Speed limit",
  speedLimitUnlimited: "0 = unlimited",
  maxConcurrent: "Max concurrent downloads",
  defaultDirectory: "Default save directory",
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
  btUploadLimit: "Upload speed limit",
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
    },
    files: {
      selectDirectories: vi.fn(async () => [])
    }
  } as unknown as LyraDesktopApi,
  updateSettings
});

describe("SettingsDownloadsView", () => {
  test("renders current download settings", async () => {
    const { api } = createDesktopApi(createSettings());
    render(<SettingsDownloadsView desktopApi={api} labels={labels} />);

    await waitFor(() => expect(screen.getByLabelText("Speed limit")).toHaveValue("1048576"));
    expect(screen.getByLabelText("Max concurrent downloads")).toHaveValue("3");
    expect(screen.getByLabelText("Default save directory")).toHaveValue("/tmp/downloads");
    expect(screen.getByLabelText("Seed time (minutes)")).toHaveValue("30");
    expect(screen.getByLabelText("Upload speed limit")).toHaveValue("");
    expect(screen.getByLabelText("Trackers")).toHaveValue("udp://tracker.example.test/announce");
    expect(screen.getByRole("switch", { name: "DHT" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Local peer discovery" })).not.toBeChecked();
    expect(screen.queryByLabelText("Proxy URL")).toBeNull();
  });

  test("shows the proxy url row only for explicit proxy modes", async () => {
    const settings = createSettings();
    const httpSettings: DownloadManagerSettings = {
      ...settings,
      proxy: { mode: "http", url: "http://proxy.example.test:8080" }
    };
    const { api } = createDesktopApi(httpSettings);
    render(<SettingsDownloadsView desktopApi={api} labels={labels} />);

    await waitFor(() => expect(screen.getByLabelText("Proxy URL")).toHaveValue(
      "http://proxy.example.test:8080"
    ));
  });

  test("commits speed limit and max concurrency on blur", async () => {
    const { api, updateSettings } = createDesktopApi(createSettings());
    render(<SettingsDownloadsView desktopApi={api} labels={labels} />);

    await waitFor(() => expect(screen.getByLabelText("Speed limit")).toHaveValue("1048576"));

    fireEvent.change(screen.getByLabelText("Speed limit"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Speed limit"));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({ speedLimitBytesPerSecond: null })
    );

    fireEvent.change(screen.getByLabelText("Max concurrent downloads"), { target: { value: "8" } });
    fireEvent.blur(screen.getByLabelText("Max concurrent downloads"));
    await waitFor(() => expect(updateSettings).toHaveBeenLastCalledWith({ maxConcurrentDownloads: 8 }));
  });

  test("routes bt switches and tracker edits through updateSettings", async () => {
    const { api, updateSettings } = createDesktopApi(createSettings());
    render(<SettingsDownloadsView desktopApi={api} labels={labels} />);

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
    render(<SettingsDownloadsView desktopApi={null} labels={labels} />);

    expect(screen.getByText("Download settings unavailable")).toBeInTheDocument();
  });
});