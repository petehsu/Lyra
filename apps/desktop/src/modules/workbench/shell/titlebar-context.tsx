import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { cx } from "../ui-primitives";

export type WorkbenchTitlebarContribution = {
  readonly ariaLabel: string;
  readonly content?: ReactNode;
  readonly leading?: ReactNode;
  readonly meta?: ReactNode;
  readonly controls?: ReactNode;
  readonly className?: string;
};

type WorkbenchTitlebarRegistry = {
  readonly registerContribution: (
    scopeId: string,
    contribution: WorkbenchTitlebarContribution
  ) => () => void;
};

const WorkbenchTitlebarRegistryContext =
  createContext<WorkbenchTitlebarRegistry | null>(null);
const WorkbenchTitlebarActiveContributionContext =
  createContext<WorkbenchTitlebarContribution | null>(null);
const WorkbenchTitlebarScopeContext = createContext<string | null>(null);

export const WorkbenchTitlebarContextProvider = ({
  activeScopeId,
  children
}: {
  readonly activeScopeId: string | null;
  readonly children: ReactNode;
}) => {
  const [contributionByScope, setContributionByScope] = useState<
    Readonly<Record<string, WorkbenchTitlebarContribution>>
  >({});

  const registerContribution = useCallback((
    scopeId: string,
    contribution: WorkbenchTitlebarContribution
  ): (() => void) => {
    setContributionByScope((current) =>
      current[scopeId] === contribution
        ? current
        : { ...current, [scopeId]: contribution }
    );
    return () => {
      setContributionByScope((current) => {
        if (current[scopeId] !== contribution) {
          return current;
        }
        const next = { ...current };
        delete next[scopeId];
        return next;
      });
    };
  }, []);

  const registry = useMemo<WorkbenchTitlebarRegistry>(
    () => ({
      registerContribution
    }),
    [registerContribution]
  );
  const activeContribution =
    activeScopeId === null ? null : contributionByScope[activeScopeId] ?? null;

  return (
    <WorkbenchTitlebarRegistryContext.Provider value={registry}>
      <WorkbenchTitlebarActiveContributionContext.Provider value={activeContribution}>
        {children}
      </WorkbenchTitlebarActiveContributionContext.Provider>
    </WorkbenchTitlebarRegistryContext.Provider>
  );
};

export const WorkbenchTitlebarScopeProvider = ({
  scopeId,
  children
}: {
  readonly scopeId: string;
  readonly children: ReactNode;
}) => (
  <WorkbenchTitlebarScopeContext.Provider value={scopeId}>
    {children}
  </WorkbenchTitlebarScopeContext.Provider>
);

export const useWorkbenchTitlebarContribution = (
  contribution: WorkbenchTitlebarContribution | null
): void => {
  const registry = useContext(WorkbenchTitlebarRegistryContext);
  const scopeId = useContext(WorkbenchTitlebarScopeContext);

  useEffect(() => {
    if (registry === null || scopeId === null || contribution === null) {
      return undefined;
    }
    return registry.registerContribution(scopeId, contribution);
  }, [contribution, registry, scopeId]);
};

export const WorkbenchTitlebarContextSlot = () => {
  const contribution = useContext(WorkbenchTitlebarActiveContributionContext);

  if (contribution === null) {
    return <div className="lyra-titlebar-context lyra-titlebar-context-empty" aria-hidden="true" />;
  }

  return (
    <section
      className={cx("lyra-titlebar-context lyra-no-drag", contribution.className)}
      aria-label={contribution.ariaLabel}
    >
      <div className="lyra-titlebar-context-scroll">
        {contribution.content ?? (
          <>
            {contribution.leading === undefined ? null : (
              <div className="lyra-titlebar-context-leading">{contribution.leading}</div>
            )}
            {contribution.meta === undefined ? null : (
              <div className="lyra-titlebar-context-meta">{contribution.meta}</div>
            )}
            {contribution.controls === undefined ? null : (
              <div className="lyra-titlebar-context-controls">{contribution.controls}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
