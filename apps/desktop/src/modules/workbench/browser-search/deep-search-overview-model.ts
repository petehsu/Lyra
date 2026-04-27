import type { SearchDeepEdge, SearchDeepNode } from "../../../shared/desktop-bridge";

export type DeepSearchOverviewLabels = {
  readonly overviewLabel: string;
  readonly selectedNodeLabel: string;
  readonly phaseLabel: string;
  readonly budgetLabel: string;
  readonly webStatusLabel: string;
  readonly localStatusLabel: string;
  readonly dedupedLabel: string;
  readonly derivedLabel: string;
  readonly roundsLabel: string;
  readonly sourceFilterLabel: string;
  readonly webLabel: string;
  readonly localLabel: string;
  readonly openLabel: string;
  readonly expandLabel: string;
  readonly centerLabel: string;
  readonly emptySelectionLabel: string;
  readonly snippetLabel: string;
  readonly sourceLabel: string;
  readonly connectedLinksLabel: string;
  readonly edgeFiltersLabel: string;
  readonly directionLabel: string;
  readonly incomingLabel: string;
  readonly outgoingLabel: string;
  readonly bothLabel: string;
  readonly discoveredLabel: string;
  readonly expandedLabel: string;
  readonly relatedLabel: string;
  readonly hostsSubdomainLabel: string;
  readonly containsPageLabel: string;
  readonly lineageLabel: string;
  readonly alternateLinksLabel: string;
  readonly revealInManagerLabel: string;
  readonly matchKindLabel: string;
  readonly lineLabel: string;
  readonly sharedTermsLabel: string;
  readonly domainLabel: string;
  readonly subdomainLabel: string;
  readonly pageLabel: string;
  readonly verifiedLabel: string;
  readonly guessedLabel: string;
  readonly discoveredByLabel: string;
  readonly verificationScoreLabel: string;
  readonly guessedDomainsLabel: string;
  readonly verifiedDomainsLabel: string;
  readonly subdomainsLabel: string;
  readonly visitedPagesLabel: string;
  readonly queuedPagesLabel: string;
  readonly droppedPagesLabel: string;
  readonly siteExpansionStatusLabel: string;
  readonly allLabel: string;
};

const BULLET = "\u00B7";

export const renderNodeMeta = (node: SearchDeepNode): string => {
  if (node.kind === "web_page") {
    return typeof node.metadata?.canonicalUrl === "string"
      ? node.metadata.canonicalUrl
      : typeof node.metadata?.url === "string"
        ? node.metadata.url
        : node.subtitle ?? "";
  }
  if (node.kind === "site_domain" || node.kind === "site_subdomain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.subtitle ?? "";
  }
  if (node.kind === "local_result") {
    return typeof node.metadata?.path === "string" ? node.metadata.path : node.subtitle ?? "";
  }
  return typeof node.metadata?.query === "string" ? node.metadata.query : node.title;
};

export const resolveEdgeKindLabel = (
  edge: SearchDeepEdge,
  labels: DeepSearchOverviewLabels
): string => {
  if (edge.kind === "discovered_from") {
    return labels.discoveredLabel;
  }
  if (edge.kind === "expanded_to") {
    return labels.expandedLabel;
  }
  if (edge.kind === "hosts_subdomain") {
    return labels.hostsSubdomainLabel;
  }
  if (edge.kind === "contains_page") {
    return labels.containsPageLabel;
  }
  return labels.relatedLabel;
};

export const formatDeepSearchEdgeReason = (
  edge: SearchDeepEdge,
  labels: DeepSearchOverviewLabels
): string => {
  if (edge.reasonCode === "web_match") {
    const engineIds = edge.metadata?.sourceEngineIds?.join(", ") ?? labels.webStatusLabel;
    return `${labels.discoveredLabel} ${BULLET} ${engineIds}`;
  }
  if (edge.reasonCode === "local_match") {
    const base = edge.metadata?.matchKind === undefined
      ? labels.localStatusLabel
      : `${labels.matchKindLabel}: ${edge.metadata.matchKind}`;
    return edge.metadata?.line === undefined ? base : `${base} ${BULLET} ${labels.lineLabel} ${edge.metadata.line}`;
  }
  if (edge.reasonCode === "query_expansion") {
    if (typeof edge.metadata?.seedQuery === "string" && typeof edge.metadata?.derivedToken === "string") {
      return `${labels.expandedLabel} ${BULLET} ${edge.metadata.seedQuery} ${BULLET} ${edge.metadata.derivedToken}`;
    }
    if (typeof edge.metadata?.seedQuery === "string") {
      return `${labels.expandedLabel} ${BULLET} ${edge.metadata.seedQuery}`;
    }
    return labels.expandedLabel;
  }
  if (edge.reasonCode === "semantic_overlap") {
    const tokens = edge.metadata?.sharedTokens?.slice(0, 3).join(", ") ?? labels.relatedLabel;
    return `${labels.sharedTermsLabel}: ${tokens}`;
  }
  if (edge.reasonCode === "domain_guess") {
    return `${labels.domainLabel} ${BULLET} ${labels.guessedLabel}`;
  }
  if (edge.reasonCode === "domain_verify") {
    return `${labels.domainLabel} ${BULLET} ${labels.verifiedLabel}`;
  }
  if (edge.reasonCode === "subdomain_guess") {
    return `${labels.subdomainLabel} ${BULLET} ${labels.guessedLabel}`;
  }
  if (edge.reasonCode === "sitemap_discovery") {
    return `${labels.pageLabel} ${BULLET} sitemap`;
  }
  if (edge.reasonCode === "html_link_discovery") {
    return `${labels.pageLabel} ${BULLET} html`;
  }
  if (edge.reasonCode === "redirect_canonical") {
    return `${labels.pageLabel} ${BULLET} canonical`;
  }
  return resolveEdgeKindLabel(edge, labels);
};

export const renderSnippet = (labels: DeepSearchOverviewLabels, node: SearchDeepNode): string => {
  if (node.kind === "web_page" && typeof node.metadata?.snippet === "string") {
    return node.metadata.snippet;
  }
  if (node.kind === "web_page" && typeof node.metadata?.contentPreview === "string") {
    return node.metadata.contentPreview;
  }
  if (node.kind === "site_domain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.title;
  }
  if (node.kind === "site_subdomain") {
    return typeof node.metadata?.finalUrl === "string" ? node.metadata.finalUrl : node.title;
  }
  if (node.kind === "local_result") {
    if (typeof node.metadata?.snippet === "string" && node.metadata.snippet.length > 0) {
      return node.metadata.snippet;
    }
    return renderNodeMeta(node);
  }
  if (typeof node.metadata?.query === "string") {
    return node.metadata.query;
  }
  return labels.emptySelectionLabel;
};

export const resolveDeepSearchPrimaryActionLabel = (
  labels: DeepSearchOverviewLabels,
  selectedNode: SearchDeepNode | null,
  localPrimaryAction: "open_file" | "reveal_in_manager"
): string =>
  selectedNode?.kind === "local_result" && localPrimaryAction === "reveal_in_manager"
    ? labels.revealInManagerLabel
    : labels.openLabel;

export const resolveDeepSearchSecondaryActionLabel = (
  labels: DeepSearchOverviewLabels,
  selectedNode: SearchDeepNode,
  localPrimaryAction: "open_file" | "reveal_in_manager"
): string => {
  if (selectedNode.kind !== "local_result") {
    return labels.openLabel;
  }
  return localPrimaryAction === "open_file" ? labels.revealInManagerLabel : labels.openLabel;
};

export const canOpenDeepSearchNode = (node: SearchDeepNode | null): boolean =>
  node?.kind === "web_page"
  || node?.kind === "site_domain"
  || node?.kind === "site_subdomain"
  || node?.kind === "local_result";
