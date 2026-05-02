import { useMemo } from "react";

import type { createTranslator } from "../i18n";
import { LOGO_URL } from "./service";

export const useWorkbenchAiLaunchProps = (
  t: ReturnType<typeof createTranslator>
) =>
  useMemo(
    () => ({
      logoUrl: LOGO_URL,
      prefix: t("ai.launchPrefix"),
      verbs: [
        t("ai.launchVerbDiscuss"),
        t("ai.launchVerbCode"),
        t("ai.launchVerbThink"),
        t("ai.launchVerbExplore"),
        t("ai.launchVerbBuild"),
        t("ai.launchVerbDebug"),
        t("ai.launchVerbCollaborate"),
        t("ai.launchVerbChat")
      ] as const
    }),
    [t]
  );
