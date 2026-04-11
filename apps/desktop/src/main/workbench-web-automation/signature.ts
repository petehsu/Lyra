import type {
  WorkbenchWebElementNode,
  WorkbenchWebElementSignature
} from "../../shared/workbench-web-automation";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const eq = (left: string | undefined, right: string | undefined): boolean =>
  normalizeText(left).length > 0
  && normalizeText(left) === normalizeText(right);

export const scoreSignatureMatch = (
  candidate: WorkbenchWebElementSignature,
  target: WorkbenchWebElementSignature
): number => {
  let score = 0;
  if (eq(candidate.tagName, target.tagName)) {
    score += 3;
  }
  if (eq(candidate.role, target.role)) {
    score += 3;
  }
  if (eq(candidate.inputType, target.inputType)) {
    score += 2;
  }
  if (eq(candidate.id, target.id)) {
    score += 6;
  }
  if (eq(candidate.name, target.name)) {
    score += 4;
  }
  if (eq(candidate.testId, target.testId)) {
    score += 7;
  }
  if (eq(candidate.ariaLabel, target.ariaLabel)) {
    score += 4;
  }
  if (eq(candidate.textHash, target.textHash)) {
    score += 2;
  }
  if (eq(candidate.structureHash, target.structureHash)) {
    score += 2;
  }
  return score;
};

export const findBestSignatureMatch = (
  nodes: readonly WorkbenchWebElementNode[],
  target: WorkbenchWebElementSignature,
  minimumScore = 8
): WorkbenchWebElementNode | null => {
  let best: WorkbenchWebElementNode | null = null;
  let bestScore = minimumScore;

  for (const node of nodes) {
    const score = scoreSignatureMatch(node.stableSignature, target);
    if (score < bestScore) {
      continue;
    }
    if (best === null || score > bestScore) {
      best = node;
      bestScore = score;
    }
  }

  return best;
};
