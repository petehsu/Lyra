import {
  Globe,
  House,
  Search,
  Settings2,
  SquareTerminal
} from "lucide-react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode, SyntheticEvent } from "react";

import type { AgentPageCitation, AgentPageCitationSourceKind } from "../../../../../../shared/agent";
import { renderWorkspaceAppIcon } from "../../../../workspace-apps";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "../../../../workspace-apps";
import type { WorkspaceTab, WorkspaceTabPageKind } from "../../../../workspace-tabs/types";
import { terminalTabIdFromPageUrl } from "./terminal-tab-citation";

const CHIP_ICON_STROKE = 1.8;

const workspaceTabPageKindFromUrl = (pageUrl: string): WorkspaceTabPageKind | null => {
  const prefix = "lyra://workspace-tab/";
  if (!pageUrl.startsWith(prefix)) {
    return null;
  }
  const rest = pageUrl.slice(prefix.length);
  const pageKind = rest.split("/")[0]?.trim();
  switch (pageKind) {
    case "search":
    case "results":
    case "page":
    case "settings":
    case "terminal":
    case "app":
      return pageKind;
    default:
      return null;
  }
};

export const resolvePageCitationSourceKind = (
  citation: AgentPageCitation
): AgentPageCitationSourceKind => {
  if (
    citation.sourceKind === "browser"
    || citation.sourceKind === "external-browser"
    || citation.sourceKind === "workspace-tab"
    || citation.sourceKind === "terminal-tab"
  ) {
    return citation.sourceKind;
  }
  if (citation.tabId.startsWith("external-page-")) {
    return "external-browser";
  }
  if (terminalTabIdFromPageUrl(citation.pageUrl) !== null) {
    return "terminal-tab";
  }
  if (citation.pageUrl.startsWith("lyra://workspace-tab/")) {
    return "workspace-tab";
  }
  return "browser";
};

export const pageCitationIconFieldsFromWorkspaceTab = (
  tab: WorkspaceTab
): Pick<
  AgentPageCitation,
  "sourceKind" | "tabPageKind" | "faviconUrl" | "appId" | "appIconKey"
> => ({
  sourceKind: "workspace-tab",
  tabPageKind: tab.pageKind,
  faviconUrl: tab.faviconUrl ?? null,
  appId: tab.appId ?? null,
  appIconKey: tab.appIconKey ?? null
});

const resolvedTabPageKind = (citation: AgentPageCitation): WorkspaceTabPageKind | null => {
  const explicit = citation.tabPageKind?.trim();
  if (
    explicit === "search"
    || explicit === "results"
    || explicit === "page"
    || explicit === "settings"
    || explicit === "terminal"
    || explicit === "app"
  ) {
    return explicit;
  }
  return workspaceTabPageKindFromUrl(citation.pageUrl);
};

const handleFaviconLoad = (event: SyntheticEvent<HTMLImageElement>) => {
  delete event.currentTarget.dataset.failed;
};

const handleFaviconError = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.failed = "true";
};

const BrowserTabDefaultIcon = ({ size }: { readonly size: number }) => (
  <Globe size={size} strokeWidth={CHIP_ICON_STROKE} />
);

type PageCitationTabIconProps = {
  readonly citation?: AgentPageCitation;
  readonly tab?: WorkspaceTab;
  readonly size?: number;
  readonly className?: string;
};

export const PageCitationTabIcon = ({
  citation,
  tab,
  size = 12,
  className = "lyra-agents-citation-chip-icon"
}: PageCitationTabIconProps) => {
  const sourceKind = tab !== undefined
    ? "workspace-tab" as const
    : citation === undefined
      ? "browser" as const
      : resolvePageCitationSourceKind(citation);

  if (sourceKind === "terminal-tab") {
    return (
      <span className={className} aria-hidden="true">
        <SquareTerminal size={size} strokeWidth={CHIP_ICON_STROKE} />
      </span>
    );
  }

  const pageKind = tab?.pageKind ?? (citation === undefined ? null : resolvedTabPageKind(citation));
  const faviconUrl = (tab?.faviconUrl ?? citation?.faviconUrl)?.trim();
  const appId = (tab?.appId ?? citation?.appId)?.trim() ?? "";
  const appIconKey = (tab?.appIconKey ?? citation?.appIconKey)?.trim() ?? "";

  if (pageKind === "settings") {
    return (
      <span className={className} aria-hidden="true">
        <Settings2 size={size} strokeWidth={CHIP_ICON_STROKE} />
      </span>
    );
  }

  if (pageKind === "results") {
    return (
      <span className={className} aria-hidden="true">
        <Search size={size} strokeWidth={CHIP_ICON_STROKE} />
      </span>
    );
  }

  if (pageKind === "search") {
    return (
      <span className={className} aria-hidden="true">
        <House size={size} strokeWidth={CHIP_ICON_STROKE} />
      </span>
    );
  }

  if (pageKind === "terminal") {
    return (
      <span className={className} aria-hidden="true">
        <SquareTerminal size={size} strokeWidth={CHIP_ICON_STROKE} />
      </span>
    );
  }

  if (pageKind === "app" && appId.length > 0 && appIconKey.length > 0) {
    return (
      <span className={className} aria-hidden="true">
        {renderWorkspaceAppIcon(appId as WorkbenchAppId, appIconKey as WorkspaceAppIconKey)}
      </span>
    );
  }

  if (faviconUrl !== undefined && faviconUrl.length > 0) {
    return (
      <span className={className} aria-hidden="true">
        <span className="lyra-agents-page-citation-chip-favicon">
          <img
            src={faviconUrl}
            alt=""
            loading="eager"
            decoding="async"
            onLoad={handleFaviconLoad}
            onError={handleFaviconError}
          />
          <span className="lyra-agents-page-citation-chip-favicon-fallback">
            <BrowserTabDefaultIcon size={size} />
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <BrowserTabDefaultIcon size={size} />
    </span>
  );
};

const iconRoots = new WeakMap<HTMLElement, Root>();

export const mountPageCitationTabIcon = (
  container: HTMLElement,
  citation: AgentPageCitation
): void => {
  let root = iconRoots.get(container);
  if (root === undefined) {
    root = createRoot(container);
    iconRoots.set(container, root);
  }
  root.render(<PageCitationTabIcon citation={citation} />);
};

export const renderPageCitationTabIconNode = (
  citation: AgentPageCitation,
  size = 12,
  className = "lyra-agents-citation-chip-icon"
): ReactNode => (
  <PageCitationTabIcon citation={citation} size={size} className={className} />
);