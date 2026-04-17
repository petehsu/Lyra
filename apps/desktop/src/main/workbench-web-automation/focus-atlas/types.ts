import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebFocusReadResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LayoutIntelligenceSnapshot } from "../layout-intelligence/types";

export type FocusAtlasBuildInput = {
  readonly tabId: string;
  readonly snapshot: LayoutIntelligenceSnapshot;
  readonly session?: WorkbenchAgentWebSession | null;
  readonly discoveryMode?: "computed" | "probe_verified";
};

export type FocusAtlasBuildResult = {
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly diagnostics: WorkbenchWebFocusReadResult["diagnostics"];
};
