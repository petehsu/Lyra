import { Bot } from "@lyra/icons";

import type { AiPanelAppIconKey } from "./types";

export const renderAiPanelAppIcon = (_iconKey: AiPanelAppIconKey) => (
  <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
);

export const renderAiPanelTopbarIcon = () => (
  <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
);
