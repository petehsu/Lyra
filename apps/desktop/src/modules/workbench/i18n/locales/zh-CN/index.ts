import type { WorkbenchDictionary } from "../../types";

import { shared } from "./shared";
import { shell } from "./shell";
import { fileManager } from "./file-manager";
import { fileEditor } from "./file-editor";
import { imageViewer } from "./image-viewer";
import { agentProjectTree } from "./agent-project-tree";
import { agentPlanBoard } from "./agent-plan-board";
import { agentGit } from "./agent-git";
import { agentSessionHistory } from "./agent-session-history";
import { loginManager } from "./login-manager";
import { softwareStore } from "./software-store";
import { notifications } from "./notifications";
import { aiPanel } from "./ai-panel";
import { location } from "./location";

export const ZH_CN_DICTIONARY: WorkbenchDictionary = {
  ...shared,
  ...shell,
  ...fileManager,
  ...fileEditor,
  ...imageViewer,
  ...agentProjectTree,
  ...agentPlanBoard,
  ...agentGit,
  ...agentSessionHistory,
  ...loginManager,
  ...softwareStore,
  ...notifications,
  ...aiPanel,
  ...location,
};
