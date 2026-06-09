import type { WorkbenchEmbeddedDocumentCandidate } from "../../shared/workbench-documents";

const sourceKindWeight = (sourceKind: WorkbenchEmbeddedDocumentCandidate["sourceKind"]): number => {
  switch (sourceKind) {
    case "top_level":
      return 50;
    case "iframe":
      return 40;
    case "embed":
      return 30;
    case "object":
      return 20;
    case "viewer_dom":
      return 10;
    default:
      return 0;
  }
};

const candidateScore = (candidate: WorkbenchEmbeddedDocumentCandidate): number => {
  let score = sourceKindWeight(candidate.sourceKind);
  if (candidate.formatHint === "pdf") {
    score += 100;
  } else if (candidate.formatHint !== "unknown") {
    score += 80;
  }
  if (typeof candidate.documentUrl === "string" && candidate.documentUrl.length > 0) {
    score += 40;
  }
  score += Math.round(candidate.visibleRatio * 100);
  if (typeof candidate.currentPageIndex === "number") {
    score += 5;
  }
  return score;
};

export const resolveActiveDocumentCandidate = (
  candidates: readonly WorkbenchEmbeddedDocumentCandidate[]
): WorkbenchEmbeddedDocumentCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((left, right) => candidateScore(right) - candidateScore(left))[0] ?? null;
};
