import type {
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "./agent-ui-types";
import type { WorkbenchLocale } from "../i18n";

export type AiPlanReviewAnnotation = {
  readonly id: string;
  readonly blockId?: string;
  readonly anchor: string;
  readonly note: string;
  readonly createdAt: number;
};

export type AiPlanReviewState = {
  readonly instanceId: string;
  readonly locale: WorkbenchLocale;
  readonly request: PlanApprovalRequest;
  readonly annotations: readonly AiPlanReviewAnnotation[];
  readonly isActionable: boolean;
  readonly isSubmitting: boolean;
  readonly lastSubmittedAt: number | null;
};

export type AiPlanReviewModel = {
  readonly getState: (instanceId: string) => AiPlanReviewState | null;
  readonly decide: (
    instanceId: string,
    response: PlanInteractionResponse
  ) => Promise<void>;
  readonly addAnnotation: (
    instanceId: string,
    annotation: Omit<AiPlanReviewAnnotation, "id" | "createdAt">
  ) => Promise<void>;
  readonly updateAnnotation: (
    instanceId: string,
    annotationId: string,
    note: string
  ) => Promise<void>;
  readonly deleteAnnotation: (
    instanceId: string,
    annotationId: string
  ) => Promise<void>;
  readonly submitAnnotations: (instanceId: string) => Promise<void>;
};
