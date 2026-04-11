import type { WebContents } from "electron";

import type {
  WorkbenchTabExtractTextResult
} from "../../shared/workbench-observation";
import type {
  BrowserTextExtractOptions,
  BrowserTextExtractionScope
} from "../workbench-observation/browser/types";

const DEFAULT_INITIAL_EXTRACT_CHARS = 24_000;
const MIN_INITIAL_EXTRACT_CHARS = 12_000;
const MAX_EXTRACT_CHARS = 24_000;

const clampRequestedChars = (
  value: number | undefined,
  hasCursor: boolean
): number => {
  const normalized = Math.max(512, Math.min(MAX_EXTRACT_CHARS, Math.round(value ?? DEFAULT_INITIAL_EXTRACT_CHARS)));
  if (hasCursor) {
    return normalized;
  }
  return Math.max(MIN_INITIAL_EXTRACT_CHARS, normalized);
};

const normalizeScope = (value: BrowserTextExtractionScope | undefined): BrowserTextExtractionScope =>
  value === "full" ? "full" : "main";

const coerceString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const coerceNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export const extractTextFromPage = async ({
  tabId,
  webContents,
  options
}: {
  readonly tabId: string;
  readonly webContents: WebContents;
  readonly options?: BrowserTextExtractOptions;
}): Promise<WorkbenchTabExtractTextResult> => {
  const scope = normalizeScope(options?.scope);
  const startChar = Math.max(0, Math.round(options?.cursor ?? 0));
  const maxChars = clampRequestedChars(options?.maxChars, startChar > 0);

  try {
    const extracted = await webContents.executeJavaScript(
      `
        (() => {
          const scope = ${JSON.stringify(scope)};
          const startChar = ${startChar};
          const maxChars = ${maxChars};
          const normalizeText = (value) => {
            if (typeof value !== "string") {
              return "";
            }
            return value
              .replace(/\\u00a0/g, " ")
              .replace(/\\r/g, "")
              .replace(/[ \\t]+\\n/g, "\\n")
              .replace(/\\n[ \\t]+/g, "\\n")
              .replace(/\\n{3,}/g, "\\n\\n")
              .trim();
          };
          const readText = (node) =>
            normalizeText(node?.innerText ?? node?.textContent ?? "");
          const chooseMainText = () => {
            const selectors = [
              "article",
              "main",
              "[role='main']",
              "#content",
              ".content",
              ".article",
              ".post",
              ".entry-content"
            ];
            let bestText = "";
            let bestMethod = "document.body";
            for (const selector of selectors) {
              const node = document.querySelector(selector);
              const nextText = readText(node);
              if (nextText.length > bestText.length) {
                bestText = nextText;
                bestMethod = selector;
              }
            }
            if (bestText.length >= 200) {
              return { text: bestText, method: bestMethod };
            }
            return {
              text: readText(document.body),
              method: "document.body"
            };
          };

          const extracted =
            scope === "full"
              ? {
                  text: readText(document.body),
                  method: "document.body"
                }
              : chooseMainText();
          const totalChars = extracted.text.length;
          const slice = extracted.text.slice(startChar, startChar + maxChars);
          const endChar = startChar + slice.length;
          return {
            text: slice,
            startChar,
            endChar,
            totalChars,
            truncated: totalChars > endChar,
            hasMore: totalChars > endChar,
            nextCursor: totalChars > endChar ? endChar : undefined,
            extractionMethod:
              scope === "full"
                ? "dom:body-inner-text"
                : "dom:main-text(" + extracted.method + ")"
          };
        })()
      `,
      true
    );

    const record = extracted as Record<string, unknown>;
    return {
      tabId,
      scope,
      text: coerceString(record.text),
      startChar: coerceNumber(record.startChar),
      endChar: coerceNumber(record.endChar),
      totalChars: coerceNumber(record.totalChars),
      hasMore: record.hasMore === true,
      ...(typeof record.nextCursor === "number" && Number.isFinite(record.nextCursor)
        ? { nextCursor: Math.max(0, Math.round(record.nextCursor)) }
        : {}),
      truncated: record.truncated === true,
      extractionMethod: coerceString(record.extractionMethod) || "dom:fallback"
    };
  } catch (_error) {
    return {
      tabId,
      scope,
      text: "",
      startChar,
      endChar: startChar,
      totalChars: 0,
      hasMore: false,
      truncated: false,
      extractionMethod: "dom:error"
    };
  }
};
