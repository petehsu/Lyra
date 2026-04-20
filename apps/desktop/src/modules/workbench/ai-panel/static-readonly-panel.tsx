type AiPanelStaticReadonlyPanelProps = {
  readonly title: string;
  readonly description: string;
  readonly hasDefaultProfile: boolean;
  readonly hasDefaultModels: boolean;
  readonly profileLabel: string;
  readonly defaultProfileName: string | null;
  readonly fallbackModelNames: readonly string[];
  readonly modelsLabel: string;
  readonly modelLabel: string;
  readonly emptyStateTitle: string;
  readonly emptyStateDescription: string;
  readonly composeAriaLabel: string;
  readonly composePlaceholder: string;
  readonly composeSendLabel: string;
};

export const AiPanelStaticReadonlyPanel = ({
  title,
  description,
  hasDefaultProfile,
  hasDefaultModels,
  profileLabel,
  defaultProfileName,
  fallbackModelNames,
  modelsLabel,
  modelLabel,
  emptyStateTitle,
  emptyStateDescription,
  composeAriaLabel,
  composePlaceholder,
  composeSendLabel,
}: AiPanelStaticReadonlyPanelProps) => (
  <div className="lyra-ai-panel-static">
    <section className="lyra-ai-panel-static-card">
      <strong>{title}</strong>
      <p>{description}</p>
      {hasDefaultProfile || hasDefaultModels ? (
        <div className="lyra-ai-panel-static-summary">
          {hasDefaultProfile ? (
            <div className="lyra-ai-panel-static-summary-row">
              <span>{profileLabel}</span>
              <strong>{defaultProfileName}</strong>
            </div>
          ) : null}
          {hasDefaultModels ? (
            <div className="lyra-ai-panel-static-summary-row">
              <span>{fallbackModelNames.length > 1 ? modelsLabel : modelLabel}</span>
              <div className="lyra-ai-panel-static-model-list">
                {fallbackModelNames.map((entry) => (
                  <span key={entry} className="lyra-ai-panel-static-model-chip">
                    {entry}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="lyra-ai-panel-static-empty">
          <strong>{emptyStateTitle}</strong>
          <span>{emptyStateDescription}</span>
        </div>
      )}
      <div className="lyra-ai-panel-static-composer">
        <textarea
          aria-label={composeAriaLabel}
          placeholder={composePlaceholder}
          readOnly
        />
        <button type="button" disabled>
          {composeSendLabel}
        </button>
      </div>
    </section>
  </div>
);
