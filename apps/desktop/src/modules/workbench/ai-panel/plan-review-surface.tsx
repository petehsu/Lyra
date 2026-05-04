import type { AiPlanReviewModel } from "./plan-review-types";

export type AiPlanReviewSurfaceProps = {
  readonly instanceId: string;
  readonly model: AiPlanReviewModel;
};

export const AiPlanReviewSurface = ({
  instanceId,
  model,
}: AiPlanReviewSurfaceProps) => {
  void instanceId;
  void model;

  return (
    <section
      className="lyra-ai-plan-review lyra-ai-plan-review-empty"
      aria-label="ai-plan-review-empty"
    >
      <strong>Plan Review</strong>
      <span>Reserved for the next Agent runtime.</span>
    </section>
  );
};
