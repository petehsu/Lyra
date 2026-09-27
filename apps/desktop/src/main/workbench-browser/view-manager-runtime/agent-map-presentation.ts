import { createHash } from "node:crypto";
import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentObservation } from "../types";
import { formatAffordanceLine, isFormField } from "./agent-affordance-lists";
import { formatPageNotes } from "./agent-page-semantics";

// This is a view over the observed index, never the index or target registry.
// Keep whole control rows below both provider transport limits (8k/16k).
export const MAP_PRESENTATION_CHARS = 6_000;
export type BrowserMapView = {
  readonly query?: string | undefined;
  readonly region?: string | undefined;
  readonly cursor?: string | undefined;
};
type MapSource = Pick<WorkbenchBrowserAgentObservation,
  "elements" | "inViewport" | "needsScroll" | "activeElementId" | "pageNotes" | "url" | "mapAppendix" | "warnings">;

export const indexedMapElements = (source: Pick<MapSource, "elements" | "inViewport" | "needsScroll">): WorkbenchBrowserAgentElement[] =>
  [...new Map([...source.elements, ...(source.inViewport ?? []), ...(source.needsScroll ?? [])]
    .map(element => [element.targetRef, element])).values()];

const regionOf = (element: WorkbenchBrowserAgentElement): string =>
  `${element.frameRef} / ${element.semantics?.context?.find(context => !context.startsWith("row:")) ?? "page"}`;
const normalize = (text: string): string => text.normalize("NFKC").toLocaleLowerCase();
const excerpt = (text: string, limit: number): string => text.length <= limit ? text : `${text.slice(0, limit)}…`;
const searchable = (element: WorkbenchBrowserAgentElement): string => normalize([
  element.targetRef, element.label, element.role, element.tooltipText, element.semantics?.description,
  ...(element.semantics?.context ?? []), element.href
].filter(Boolean).join("\n"));

const compactLine = (element: WorkbenchBrowserAgentElement, all: readonly WorkbenchBrowserAgentElement[]): string => {
  // Keep state facts in the regular formatter; trim verbose values/descriptions
  // only in the presentation. Searching a targetRef retrieves its detailed row.
  const { cursor: _cursor, tooltipText: _tooltip, textSnippet, semantics, ...base } = element;
  const shortFacts = semantics === undefined ? undefined : (() => {
    const { description, controls: _controls, context, ...facts } = semantics;
    return { ...facts, ...(description === undefined ? {} : { description: excerpt(description, 120) }), ...(context === undefined ? {} : { context: context.map(item => excerpt(item, 100)).slice(0, 2) }) };
  })();
  const short = { ...base, label: excerpt(element.label, 180),
    ...(textSnippet === undefined ? {} : { textSnippet: excerpt(textSnippet, 160) }),
    ...(shortFacts === undefined ? {} : { semantics: shortFacts }) };
  return formatAffordanceLine(short, all)
    + (element.cursor ? ` cursor=${element.cursor.keyword}${element.cursor.customImage ? " (custom image; fallback hint only)" : ""}` : "")
    + (element.semantics?.controls?.length ? " [relations: query this targetRef for details]" : "")
    + (element.visibility?.offscreen ? " [offscreen; act scrolls to target]" : "");
};

export const presentBrowserMap = (source: MapSource, view: BrowserMapView = {}, maxChars = MAP_PRESENTATION_CHARS): string => {
  if (!view.query && !view.region && !view.cursor && source.mapAppendix?.startsWith("Index:")
    && source.mapAppendix.length <= maxChars) return source.mapAppendix;
  const all = indexedMapElements(source);
  const query = normalize(view.query?.trim() ?? "");
  const region = normalize(view.region?.trim() ?? "");
  const focused = all.find(element => element.id === source.activeElementId || element.semantics?.focused);
  const focusedRegion = focused === undefined ? undefined : regionOf(focused);
  const score = (element: WorkbenchBrowserAgentElement): number =>
    (element === focused ? 2_000 : 0)
    + (focusedRegion !== undefined && !focusedRegion.endsWith(" / page") && regionOf(element) === focusedRegion ? 1_000 : 0)
    + (element.visibility?.inPopup || element.semantics?.context?.some(context => context.startsWith("dialog:")) ? 500 : 0)
    + (element.semantics?.invalid ? 200 : 0) + (isFormField(element) ? 100 : 0)
    + (element.visibility?.offscreen ? 0 : 50);
  const regional = all.filter(element => !region || normalize(regionOf(element)).includes(region));
  const tokens = query.split(/\s+/u).filter(Boolean);
  // Names are stronger evidence than inherited region text or a URL. Rare
  // matching terms rank ahead of ubiquitous "button"/"page" words, without
  // excluding any match or guessing the user's intended activation.
  const blobs = new Map(regional.map(element => [element, searchable(element)]));
  const weights = new Map(tokens.map(token => [token,
    Math.log(1 + regional.length / (1 + regional.filter(element => blobs.get(element)!.includes(token)).length))]));
  const relevance = new Map(regional.map(element => {
    const name = normalize([element.label, element.tooltipText].filter(Boolean).join(" "));
    const description = normalize(element.semantics?.description ?? "");
    const value = tokens.reduce((sum, token) => sum + weights.get(token)! *
      (name.includes(token) ? 8 : description.includes(token) ? 4
        : normalize(element.role).includes(token) ? 1 : blobs.get(element)!.includes(token) ? 0.25 : 0), 0);
    return [element, value];
  }));
  const exact = regional.filter(element => !query || searchable(element).includes(query));
  const allTerms = exact.length || query.startsWith("lumen:") ? []
    : regional.filter(element => tokens.every(token => searchable(element).includes(token)));
  const mode = exact.length || !query || query.startsWith("lumen:") ? "phrase" : allTerms.length ? "all terms" : "any terms";
  const matches = (mode === "phrase" ? exact : mode === "all terms" ? allTerms
    : regional.filter(element => tokens.some(token => searchable(element).includes(token))))
    .sort((left, right) => (query ? relevance.get(right)! - relevance.get(left)! : 0)
      || score(right) - score(left) || left.id - right.id);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    source.url, query, region, matches.map(element => [element.targetRef, element.label, regionOf(element)])
  ])).digest("hex").slice(0, 20);
  let offset = 0;
  if (view.cursor) {
    const [version, next] = view.cursor.split(":");
    if (version !== fingerprint || !/^\d+$/.test(next ?? "") || Number(next) >= matches.length) {
      return "Map page changed or cursor does not match this query/region. No targets were selected. Call browser_map again without cursor; keep the same query/region to restart.";
    }
    offset = Number(next);
  }
  const regions = new Map<string, number>();
  for (const element of all) regions.set(regionOf(element), (regions.get(regionOf(element)) ?? 0) + 1);
  const header = [`Index: ${all.length} observed controls; ${matches.length} matching. No importance-based exclusions.`];
  if (query) header.push(`Search matching: ${mode}. Candidates are never activated automatically.`);
  if (query && focused && !matches.includes(focused)) header.push("Focused field context (outside search results): " + compactLine(focused, all));
  if (all.some(element => element.cursor)) header.push("CSS cursor hints describe appearance, not verified actions or outcomes.");
  const coverage = (source.warnings ?? []).filter(warning => /limit|skipp|unavailable|closed.shadow|covered/i.test(warning));
  if (coverage.length) header.push("Coverage: " + excerpt(coverage.join("; "), 450));
  const notes = formatPageNotes(source.pageNotes ?? []);
  if (notes) header.push(excerpt(notes, 900));
  header.push("Regions: " + excerpt([...regions].map(([name, count]) => `${JSON.stringify(name)} (${count})`).join("; "), 700));
  const help = "Find any indexed control: browser_map({query: name/role/targetRef or keywords, region?: region text}). Continue with cursor and the same filters. Unmounted/virtualized content requires scrolling or opening its container.";
  if (!view.query && !view.region && !view.cursor && source.mapAppendix
    && source.mapAppendix.length + header.join("\n").length + help.length + 4 <= maxChars
    && all.length <= 24) {
    return [header[0], ...(coverage.length ? ["Coverage: " + excerpt(coverage.join("; "), 450)] : []), source.mapAppendix, help].join("\n");
  }
  const lines: string[] = [];
  const detailed = matches.length === 1 && query === normalize(matches[0]!.targetRef);
  const budget = maxChars - header.join("\n").length - help.length - 240;
  let length = 0;
  for (const element of matches.slice(offset)) {
    let line = detailed ? formatAffordanceLine(element, all) : compactLine(element, all);
    if (line.length > budget) line = compactLine(element, all);
    // Never cut a target row in the transport or silently skip an oversized row.
    if (line.length > budget) line = `[${element.id} targetRef=${element.targetRef}] ${excerpt(element.role, 40)}: ${JSON.stringify(excerpt(element.label, 500))} [details exceed map budget; read this control's page text]`;
    if (length + line.length + 1 > budget) break;
    lines.push(line);
    length += line.length + 1;
  }
  const end = offset + lines.length;
  const next = end < matches.length ? ` Next cursor=${fingerprint}:${end}` : " End of matching index.";
  return [...header, `Showing ${matches.length ? offset + 1 : 0}–${end} of ${matches.length}.${next}`,
    ...(lines.length ? lines : ["No matching controls in the observed index. Broaden the query/region or reveal more of the page."]), help].join("\n");
};
