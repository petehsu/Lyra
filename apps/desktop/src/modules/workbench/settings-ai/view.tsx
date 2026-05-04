import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  void model;

  return (
    <section className="lyra-settings-group">
      <header className="lyra-settings-group-header lyra-settings-ai-header">
        <h3>{labels.profilesTitle}</h3>
      </header>

      <div className="lyra-settings-ai-empty lyra-settings-ai-empty-panel">
        <strong>{labels.emptyTitle}</strong>
        <small>Reserved for the next Agent runtime.</small>
      </div>
    </section>
  );
};
