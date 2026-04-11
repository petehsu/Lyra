import type { WorkbenchTabExtractTextResult } from "../../../shared/workbench-observation";

const DEFAULT_RESULT_BYTE_BUDGET = 28_500;
const MAX_FETCH_ROUNDS = 4;

const estimateSerializedBytes = (result: WorkbenchTabExtractTextResult): number =>
  Buffer.byteLength(JSON.stringify(result), "utf8");

const buildTrimmedResult = (
  result: WorkbenchTabExtractTextResult,
  nextText: string
): WorkbenchTabExtractTextResult => {
  const endChar = result.startChar + nextText.length;
  return {
    ...result,
    text: nextText,
    endChar,
    hasMore: true,
    nextCursor: endChar,
    truncated: true
  };
};

const trimResultToBudget = (
  result: WorkbenchTabExtractTextResult,
  byteBudget: number
): WorkbenchTabExtractTextResult => {
  if (estimateSerializedBytes(result) <= byteBudget) {
    return result;
  }
  let low = 0;
  let high = result.text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = buildTrimmedResult(result, result.text.slice(0, mid));
    if (estimateSerializedBytes(candidate) <= byteBudget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return buildTrimmedResult(result, result.text.slice(0, low));
};

const mergeResults = (
  current: WorkbenchTabExtractTextResult,
  next: WorkbenchTabExtractTextResult,
  byteBudget: number
): WorkbenchTabExtractTextResult => {
  const overlap = Math.max(0, current.endChar - next.startChar);
  const appendedText = overlap >= next.text.length ? "" : next.text.slice(overlap);
  const mergedBase = {
    tabId: current.tabId,
    scope: current.scope,
    text: current.text + appendedText,
    startChar: current.startChar,
    endChar: current.endChar + appendedText.length,
    totalChars: Math.max(current.totalChars, next.totalChars),
    hasMore: next.hasMore,
    truncated: next.truncated,
    extractionMethod:
      current.extractionMethod === next.extractionMethod
        ? current.extractionMethod
        : `${current.extractionMethod}+continued`
  };
  if (next.hasMore) {
    return trimResultToBudget(
      {
        ...mergedBase,
        nextCursor: next.nextCursor ?? (next.startChar + next.text.length)
      },
      byteBudget
    );
  }
  return trimResultToBudget(mergedBase, byteBudget);
};

export const accumulateExtractedText = async ({
  byteBudget = DEFAULT_RESULT_BYTE_BUDGET,
  fetchChunk,
  initial,
  maxCharsPerFetch
}: {
  readonly initial: WorkbenchTabExtractTextResult;
  readonly maxCharsPerFetch: number;
  readonly fetchChunk: (cursor: number, maxChars: number) => Promise<WorkbenchTabExtractTextResult>;
  readonly byteBudget?: number;
}): Promise<WorkbenchTabExtractTextResult> => {
  let current = trimResultToBudget(initial, byteBudget);
  for (let round = 0; round < MAX_FETCH_ROUNDS; round += 1) {
    if (!current.hasMore || current.nextCursor === undefined) {
      return current;
    }
    const previousEndChar = current.endChar;
    const next = await fetchChunk(current.nextCursor, maxCharsPerFetch);
    current = mergeResults(current, next, byteBudget);
    if (current.endChar <= previousEndChar) {
      return current;
    }
  }
  return current;
};
