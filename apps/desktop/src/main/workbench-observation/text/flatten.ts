import type {
  DeepSearchObservation,
  FileEditorObservation,
  FileManagerObservation,
  ImageViewerObservation,
  SearchHomeObservation,
  SearchResultsObservation,
  TerminalObservation,
  WorkbenchTabExtractTextResult,
  WorkbenchTabExtractTextScope,
  WorkbenchTabObservation
} from "../../../shared/workbench-observation";

const truncateText = (
  value: string,
  maxChars: number
): { readonly text: string; readonly truncated: boolean } =>
  value.length > maxChars
    ? {
        text: value.slice(0, maxChars),
        truncated: true
      }
    : {
        text: value,
        truncated: false
      };

const flattenFileEditor = (observation: FileEditorObservation): string =>
  [
    `File: ${observation.filePath}`,
    `Language: ${observation.languageId}`,
    `Status: ${observation.status}`,
    "",
    observation.content
  ].join("\n");

const flattenFileManager = (observation: FileManagerObservation): string => {
  const header = [
    `View: ${observation.viewKind}`,
    `Presentation: ${observation.presentationMode}`,
    `Location: ${
      observation.currentLocation?.path
      ?? observation.currentLocation?.title
      ?? observation.currentLocation?.kind
      ?? "unknown"
    }`
  ];
  const entries = observation.entries.map((entry, index) => {
    const details = [
      `${index + 1}. ${entry.name}`,
      `path=${entry.path}`,
      ...(entry.kind === undefined ? [] : [`kind=${entry.kind}`]),
      ...(entry.sizeBytes === undefined ? [] : [`size=${entry.sizeBytes}`]),
      ...(entry.modifiedAt === undefined ? [] : [`modified=${entry.modifiedAt}`])
    ];
    return details.join(" | ");
  });
  return [...header, "", "Entries:", ...entries].join("\n");
};

const flattenImageViewer = (observation: ImageViewerObservation): string => {
  const lines = [
    `Image: ${observation.filePath}`,
    `Title: ${observation.title}`,
    `Status: ${observation.status}`,
    ...(observation.mimeType === undefined ? [] : [`MIME: ${observation.mimeType}`]),
    ...(observation.format === undefined ? [] : [`Format: ${observation.format}`]),
    ...(observation.width === undefined || observation.height === undefined
      ? []
      : [`Dimensions: ${observation.width}x${observation.height}`]),
    ...(observation.sizeBytes === undefined ? [] : [`Size bytes: ${observation.sizeBytes}`]),
    ...(observation.sourceUrl === undefined ? [] : [`Source URL: ${observation.sourceUrl}`]),
    ...(observation.cacheState === undefined ? [] : [`Cache: ${observation.cacheState}`]),
    `Viewport: zoom=${observation.viewport.zoom} rotation=${observation.viewport.rotation} background=${observation.viewport.background}`,
    `Siblings: ${observation.siblingIndex + 1}/${observation.siblingCount}`
  ];
  if (observation.message !== undefined) {
    lines.push(`Message: ${observation.message}`);
  }
  return lines.join("\n");
};

const flattenTerminal = (observation: TerminalObservation): string => {
  const activePane = observation.panes.find((pane) => pane.paneId === observation.activePaneId);
  const header = [
    `Active pane: ${observation.activePaneId}`,
    ...(activePane === undefined ? [] : [`Title: ${activePane.title}`]),
    ...(activePane?.cwd === undefined ? [] : [`CWD: ${activePane.cwd}`]),
    ...(activePane?.shell === undefined ? [] : [`Shell: ${activePane.shell}`]),
    `Running: ${observation.running ? "yes" : "no"}`,
    `Exit code: ${observation.exitCode === null ? "null" : String(observation.exitCode)}`
  ];
  return [...header, "", observation.activeOutput].join("\n");
};

const flattenSearchHome = (observation: SearchHomeObservation): string =>
  [
    "Search home",
    `Mode: ${observation.searchMode}`,
    `Input: ${observation.inputValue}`
  ].join("\n");

const flattenSearchResults = (observation: SearchResultsObservation): string => {
  const lines = [
    `Query: ${observation.query}`,
    `Web status: ${observation.webStatus}`,
    `Local status: ${observation.localStatus}`,
    "",
    "Web results:"
  ];
  for (const [index, result] of observation.blendedResults.entries()) {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    if (result.snippet.length > 0) {
      lines.push(`Snippet: ${result.snippet}`);
    }
    lines.push("");
  }
  lines.push("Local results:");
  for (const [index, result] of observation.localResults.entries()) {
    lines.push(
      `${index + 1}. ${result.path}${result.line === undefined ? "" : `:${result.line}`}`
    );
    if ((result.snippet ?? "").length > 0) {
      lines.push(`Snippet: ${result.snippet}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
};

const flattenDeepSearch = (observation: DeepSearchObservation): string => {
  const lines = [
    `Query: ${observation.query}`,
    `Budget: ${observation.budgetPreset}`,
    `Status: ${observation.status}`,
    `Done: ${observation.done ? "yes" : "no"}`,
    `Nodes: ${observation.nodeCount}`,
    `Edges: ${observation.edgeCount}`,
    "",
    "Nodes:"
  ];
  for (const node of observation.nodes) {
    lines.push(`- [${node.kind}] ${node.title} (${node.id})`);
  }
  lines.push("", "Edges:");
  for (const edge of observation.edges) {
    lines.push(`- [${edge.kind}] ${edge.from} -> ${edge.to} (${edge.id})`);
  }
  return lines.join("\n");
};

const flattenObservation = (observation: WorkbenchTabObservation): string => {
  switch (observation.kind) {
    case "file-editor":
      return flattenFileEditor(observation);
    case "file-manager":
      return flattenFileManager(observation);
    case "image-viewer":
      return flattenImageViewer(observation);
    case "terminal":
      return flattenTerminal(observation);
    case "search-home":
      return flattenSearchHome(observation);
    case "search-results":
      return flattenSearchResults(observation);
    case "deep-search-results":
      return flattenDeepSearch(observation);
    case "page":
      return observation.mainTextExcerpt;
  }
};

const observationWasTruncated = (observation: WorkbenchTabObservation): boolean =>
  observation.kind === "search-home" ? false : observation.truncated;

const supportsCursorContinuation = (observation: WorkbenchTabObservation): boolean =>
  observation.kind === "file-editor";

export const createExtractedObservationText = ({
  tabId,
  scope,
  cursor,
  observation,
  maxChars
}: {
  readonly tabId: string;
  readonly scope: WorkbenchTabExtractTextScope;
  readonly cursor: number;
  readonly observation: WorkbenchTabObservation;
  readonly maxChars: number;
}): WorkbenchTabExtractTextResult => {
  const flattened = flattenObservation(observation);
  const boundedCursor = Math.max(0, Math.min(cursor, flattened.length));
  const slicedValue = flattened.slice(boundedCursor, boundedCursor + maxChars);
  const endChar = boundedCursor + slicedValue.length;
  const hasMoreFromSlice = endChar < flattened.length;
  const hasMoreFromSource = observationWasTruncated(observation) && supportsCursorContinuation(observation);
  const hasMore = hasMoreFromSlice || hasMoreFromSource;
  return {
    tabId,
    scope,
    text: slicedValue,
    startChar: boundedCursor,
    endChar,
    totalChars: flattened.length,
    hasMore,
    ...(hasMore ? { nextCursor: endChar } : {}),
    truncated: observationWasTruncated(observation) || hasMoreFromSlice,
    extractionMethod: `structured:${observation.kind}`
  };
};
