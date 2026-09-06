import { useEffect, useState } from "react";

import type {
  DownloadManagerSettings,
  DownloadManagerUpdateSettingsRequest
} from "../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  AppButton,
  AppInput,
  AppSelect,
  AppSettingsRow,
  AppSettingsSection,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import type { SettingsDownloadsLabels } from "./types";

type Props = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsDownloadsLabels;
};

const proxyModeValues = ["system", "direct", "http", "socks5"] as const;

const parseOptionalBytes = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parsePositiveInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const formatOptionalBytes = (value: number | null): string =>
  value === null ? "" : String(value);

export const SettingsDownloadsView = ({ desktopApi, labels }: Props) => {
  const downloads = desktopApi?.downloads;
  const [settings, setSettings] = useState<DownloadManagerSettings | null>(null);
  const [speedLimitDraft, setSpeedLimitDraft] = useState("");
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState("3");
  const [defaultDirectoryDraft, setDefaultDirectoryDraft] = useState("");
  const [proxyUrlDraft, setProxyUrlDraft] = useState("");
  const [seedTimeDraft, setSeedTimeDraft] = useState("0");
  const [uploadLimitDraft, setUploadLimitDraft] = useState("");
  const [trackersDraft, setTrackersDraft] = useState("");

  useEffect(() => {
    if (downloads === undefined) {
      return;
    }
    let cancelled = false;
    downloads.readSettings()
      .then((next) => {
        if (cancelled) {
          return;
        }
        setSettings(next);
        setSpeedLimitDraft(formatOptionalBytes(next.speedLimitBytesPerSecond));
        setMaxConcurrentDraft(String(next.maxConcurrentDownloads));
        setDefaultDirectoryDraft(next.defaultDirectory ?? "");
        setProxyUrlDraft(next.proxy.url ?? "");
        setSeedTimeDraft(String(next.bt.seedTimeMinutes));
        setUploadLimitDraft(formatOptionalBytes(next.bt.maxUploadBytesPerSecond));
        setTrackersDraft(next.bt.trackerUrls.join("\n"));
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [downloads]);

  if (downloads === undefined) {
    return (
      <AppSettingsSection label={labels.title}>
        <AppSettingsRow title={labels.unavailable} />
      </AppSettingsSection>
    );
  }

  const update = async (request: DownloadManagerUpdateSettingsRequest): Promise<void> => {
    const next = await downloads.updateSettings(request);
    setSettings(next);
    setSpeedLimitDraft(formatOptionalBytes(next.speedLimitBytesPerSecond));
    setMaxConcurrentDraft(String(next.maxConcurrentDownloads));
    setDefaultDirectoryDraft(next.defaultDirectory ?? "");
    setProxyUrlDraft(next.proxy.url ?? "");
    setSeedTimeDraft(String(next.bt.seedTimeMinutes));
    setUploadLimitDraft(formatOptionalBytes(next.bt.maxUploadBytesPerSecond));
    setTrackersDraft(next.bt.trackerUrls.join("\n"));
  };

  if (settings === null) {
    return (
      <AppSettingsSection label={labels.title}>
        <AppSettingsRow title={labels.unavailable} />
      </AppSettingsSection>
    );
  }

  const commitSpeedLimit = (): void => {
    const parsed = parseOptionalBytes(speedLimitDraft);
    if (parsed !== undefined) {
      void update({ speedLimitBytesPerSecond: parsed });
    }
  };

  const commitMaxConcurrent = (): void => {
    const next = parsePositiveInt(maxConcurrentDraft, settings.maxConcurrentDownloads);
    if (next !== settings.maxConcurrentDownloads) {
      void update({ maxConcurrentDownloads: next });
    }
  };

  const commitDefaultDirectory = (): void => {
    const trimmed = defaultDirectoryDraft.trim();
    if (trimmed !== (settings.defaultDirectory ?? "")) {
      void update({ defaultDirectory: trimmed.length === 0 ? null : trimmed });
    }
  };

  const chooseDefaultDirectory = async (): Promise<void> => {
    const selected = await desktopApi?.files.selectDirectories();
    const path = selected?.[0]?.path;
    if (path !== undefined && path !== (settings.defaultDirectory ?? "")) {
      void update({ defaultDirectory: path });
    }
  };

  const commitProxyUrl = (): void => {
    const trimmed = proxyUrlDraft.trim();
    if (trimmed !== (settings.proxy.url ?? "")) {
      void update({ proxy: { ...settings.proxy, url: trimmed.length === 0 ? undefined : trimmed } });
    }
  };

  const commitSeedTime = (): void => {
    const next = parseNonNegativeInt(seedTimeDraft, settings.bt.seedTimeMinutes);
    if (next !== settings.bt.seedTimeMinutes) {
      void update({ bt: { ...settings.bt, seedTimeMinutes: next } });
    }
  };

  const commitUploadLimit = (): void => {
    const parsed = parseOptionalBytes(uploadLimitDraft);
    if (parsed !== undefined) {
      void update({ bt: { ...settings.bt, maxUploadBytesPerSecond: parsed } });
    }
  };

  const commitTrackers = (): void => {
    const urls = trackersDraft
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (urls.join("\n") !== settings.bt.trackerUrls.join("\n")) {
      void update({ bt: { ...settings.bt, trackerUrls: urls } });
    }
  };

  return (
    <div className="lyra-settings-downloads">
      <AppSettingsSection label={labels.title}>
        <AppSettingsRow
          title={labels.speedLimit}
          description={labels.speedLimitUnlimited}
          control={(
            <AppInput
              aria-label={labels.speedLimit}
              className="lyra-settings-input lyra-settings-inline-input"
              inputMode="numeric"
              value={speedLimitDraft}
              onChange={(event) => {
                setSpeedLimitDraft(event.target.value);
              }}
              onBlur={commitSpeedLimit}
            />
          )}
        />
        <AppSettingsRow
          title={labels.maxConcurrent}
          control={(
            <AppInput
              aria-label={labels.maxConcurrent}
              className="lyra-settings-input lyra-settings-inline-input"
              inputMode="numeric"
              value={maxConcurrentDraft}
              onChange={(event) => {
                setMaxConcurrentDraft(event.target.value);
              }}
              onBlur={commitMaxConcurrent}
            />
          )}
        />
        <AppSettingsRow
          title={labels.defaultDirectory}
          control={(
            <span className="lyra-settings-import-project-actions">
              <AppInput
                aria-label={labels.defaultDirectory}
                className="lyra-settings-input lyra-settings-inline-input"
                value={defaultDirectoryDraft}
                onChange={(event) => {
                  setDefaultDirectoryDraft(event.target.value);
                }}
                onBlur={commitDefaultDirectory}
              />
              <AppButton type="button" variant="secondary" onClick={() => void chooseDefaultDirectory()}>
                {labels.chooseDirectory}
              </AppButton>
            </span>
          )}
        />
      </AppSettingsSection>
      <AppSettingsSection label={labels.proxySection}>
        <AppSettingsRow
          title={labels.proxyMode}
          control={(
            <AppSelect
              ariaLabel={labels.proxyMode}
              className="lyra-settings-select"
              contentClassName="lyra-settings-select-content"
              value={settings.proxy.mode}
              options={[
                { value: "system", label: labels.proxyModeSystem },
                { value: "direct", label: labels.proxyModeDirect },
                { value: "http", label: labels.proxyModeHttp },
                { value: "socks5", label: labels.proxyModeSocks5 }
              ]}
              onValueChange={(mode) => {
                if (mode !== settings.proxy.mode) {
                  void update({ proxy: { mode, url: settings.proxy.url } });
                }
              }}
            />
          )}
        />
        {settings.proxy.mode === "http" || settings.proxy.mode === "socks5" ? (
          <AppSettingsRow
            title={labels.proxyUrl}
            control={(
              <AppInput
                aria-label={labels.proxyUrl}
                className="lyra-settings-input lyra-settings-inline-input"
                value={proxyUrlDraft}
                placeholder={labels.proxyUrlPlaceholder}
                onChange={(event) => {
                  setProxyUrlDraft(event.target.value);
                }}
                onBlur={commitProxyUrl}
              />
            )}
          />
        ) : null}
      </AppSettingsSection>
      <AppSettingsSection label={labels.btSection}>
        <AppSettingsRow
          title={labels.btDht}
          control={(
            <AppSwitch
              checked={settings.bt.dhtEnabled}
              aria-label={labels.btDht}
              onCheckedChange={(dhtEnabled) => {
                void update({ bt: { ...settings.bt, dhtEnabled } });
              }}
            />
          )}
        />
        <AppSettingsRow
          title={labels.btPeerExchange}
          control={(
            <AppSwitch
              checked={settings.bt.peerExchangeEnabled}
              aria-label={labels.btPeerExchange}
              onCheckedChange={(peerExchangeEnabled) => {
                void update({ bt: { ...settings.bt, peerExchangeEnabled } });
              }}
            />
          )}
        />
        <AppSettingsRow
          title={labels.btLocalPeerDiscovery}
          control={(
            <AppSwitch
              checked={settings.bt.localPeerDiscoveryEnabled}
              aria-label={labels.btLocalPeerDiscovery}
              onCheckedChange={(localPeerDiscoveryEnabled) => {
                void update({ bt: { ...settings.bt, localPeerDiscoveryEnabled } });
              }}
            />
          )}
        />
        <AppSettingsRow
          title={labels.btSeedTime}
          control={(
            <AppInput
              aria-label={labels.btSeedTime}
              className="lyra-settings-input lyra-settings-inline-input"
              inputMode="numeric"
              value={seedTimeDraft}
              onChange={(event) => {
                setSeedTimeDraft(event.target.value);
              }}
              onBlur={commitSeedTime}
            />
          )}
        />
        <AppSettingsRow
          title={labels.btUploadLimit}
          description={labels.speedLimitUnlimited}
          control={(
            <AppInput
              aria-label={labels.btUploadLimit}
              className="lyra-settings-input lyra-settings-inline-input"
              inputMode="numeric"
              value={uploadLimitDraft}
              onChange={(event) => {
                setUploadLimitDraft(event.target.value);
              }}
              onBlur={commitUploadLimit}
            />
          )}
        />
        <AppSettingsRow
          className="lyra-settings-row-block-control"
          title={labels.btTrackers}
          control={(
            <AppTextarea
              aria-label={labels.btTrackers}
              className="lyra-settings-textarea"
              value={trackersDraft}
              placeholder={labels.btTrackersPlaceholder}
              onChange={(event) => {
                setTrackersDraft(event.target.value);
              }}
              onBlur={commitTrackers}
            />
          )}
        />
      </AppSettingsSection>
    </div>
  );
};