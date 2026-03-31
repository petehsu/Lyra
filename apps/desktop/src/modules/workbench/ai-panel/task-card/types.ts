import type { ReactNode } from "react";

import type { AiPanelRuntimeDecision, AiPanelRuntimeItem, AiPanelRuntimePresentation, AiPanelRuntimeStatus } from "../runtime";

export type AiTaskCardMetrics = {
  readonly addedLines: number;
  readonly removedLines: number;
};

export type AiTaskCardItem = {
  readonly id: string;
  readonly kind: string;
  readonly builtinKind: AiPanelRuntimeItem["kind"];
  readonly title: string;
  readonly summary: string;
  readonly status: AiPanelRuntimeStatus;
  readonly presentation: AiPanelRuntimePresentation;
  readonly decision?: AiPanelRuntimeDecision;
  readonly filePath?: string;
  readonly metrics?: AiTaskCardMetrics;
  readonly payload?: unknown;
  readonly runtimeItem: AiPanelRuntimeItem;
};

export type AiTaskCardRenderContext = {
  readonly item: AiTaskCardItem;
  readonly isWorking: boolean;
  readonly renderScanText: (value: string, keyPrefix: string) => ReactNode;
};

export type AiTaskCardRenderer = (
  context: AiTaskCardRenderContext
) => ReactNode;
