import type {
  WorkbenchChromeContributionV1,
  WorkbenchChromeScopeV1,
  WorkbenchChromeSlotV1
} from "@lyra/app-runtime";
import { workbenchChromeScopeKey } from "@lyra/app-runtime";
import { useEffect, useRef, useState } from "react";

import { workbenchChromeBus } from "./workbench-chrome-bus";

const chromeContributionEquals = (
  left: WorkbenchChromeContributionV1 | null,
  right: WorkbenchChromeContributionV1 | null
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const useWorkbenchChromeBusContribution = (
  scope: WorkbenchChromeScopeV1,
  slot: WorkbenchChromeSlotV1
): WorkbenchChromeContributionV1 | null => {
  const scopeKey = workbenchChromeScopeKey(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [contribution, setContribution] = useState<WorkbenchChromeContributionV1 | null>(
    () => workbenchChromeBus.read(scope, slot)
  );

  useEffect(() => {
    const apply = (): void => {
      const next = workbenchChromeBus.read(scopeRef.current, slot);
      setContribution((current) => (chromeContributionEquals(current, next) ? current : next));
    };
    apply();
    return workbenchChromeBus.subscribe((payload) => {
      if (payload.scopeKey !== scopeKey || payload.slot !== slot) {
        return;
      }
      apply();
    });
  }, [scopeKey, slot]);

  return contribution;
};
