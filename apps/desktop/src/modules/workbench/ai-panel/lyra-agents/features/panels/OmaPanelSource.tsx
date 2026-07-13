import type { OmaAgentMember } from "../../../../../../shared/agent";

export function OmaPanelSource({ agent }: { readonly agent: OmaAgentMember | null | undefined }) {
  if (agent === null || agent === undefined) return null;
  const avatar = agent.avatar.src?.trim();

  return (
    <span className="lyra-agents-oma-panel-source" title={agent.role}>
      <span className="lyra-agents-oma-panel-source-avatar" aria-hidden="true">
        {avatar ? (
          <img src={`data:image/svg+xml,${encodeURIComponent(avatar)}`} alt="" />
        ) : (
          agent.avatar.value.slice(0, 1)
        )}
      </span>
      <span>{agent.name}</span>
    </span>
  );
}
