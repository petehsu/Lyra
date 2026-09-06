import type { ReactNode } from "react";

const createEngineAssetUrl = (fileName: string): string =>
  new URL(`./assets/engines/${fileName}`, import.meta.url).toString();

export type WebSearchEngineBrandAsset = {
  readonly url: string;
};

export const WEB_SEARCH_ENGINE_BRAND_ASSETS: Partial<
  Record<string, WebSearchEngineBrandAsset>
> = {
  google: { url: createEngineAssetUrl("google.svg") },
  bing: { url: createEngineAssetUrl("bing.svg") }
};

export const resolveWebSearchEngineBrandAsset = (
  engineId: string
): WebSearchEngineBrandAsset | null =>
  WEB_SEARCH_ENGINE_BRAND_ASSETS[engineId] ?? null;

export const renderWebSearchEngineBrandIcon = (engineId: string): ReactNode => {
  const asset = resolveWebSearchEngineBrandAsset(engineId);
  if (asset === null) {
    return null;
  }
  return (
    <img
      className="lyra-settings-engine-brand-icon"
      src={asset.url}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
};