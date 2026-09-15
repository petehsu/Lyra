import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

const CLOSED = "__none__";

export type ToolAccordionApi = {
  readonly isGroupOpen: (groupId: string, live: boolean) => boolean;
  readonly isEntryOpen: (entryId: string, live: boolean) => boolean;
  readonly toggleGroup: (groupId: string, currentlyOpen: boolean) => void;
  readonly toggleEntry: (groupId: string, entryId: string, currentlyOpen: boolean) => void;
  readonly expandLive: (groupId: string, entryId: string) => void;
};

const ToolAccordionContext = createContext<ToolAccordionApi | null>(null);

export function ToolAccordionProvider({
  children
}: {
  readonly children: ReactNode;
}) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);

  const isGroupOpen = useCallback((id: string, live: boolean): boolean => {
    if (groupId === CLOSED) {
      return false;
    }
    if (groupId === id) {
      return true;
    }
    return groupId === null && live;
  }, [groupId]);

  const isEntryOpen = useCallback((id: string, live: boolean): boolean => {
    if (entryId === CLOSED) {
      return false;
    }
    if (entryId === id) {
      return true;
    }
    return entryId === null && live;
  }, [entryId]);

  const toggleGroup = useCallback((id: string, currentlyOpen: boolean): void => {
    if (currentlyOpen) {
      setGroupId(CLOSED);
      setEntryId(CLOSED);
      return;
    }
    setGroupId(id);
    setEntryId(null);
  }, []);

  const toggleEntry = useCallback((id: string, nextEntryId: string, currentlyOpen: boolean): void => {
    setGroupId(id);
    setEntryId(currentlyOpen ? CLOSED : nextEntryId);
  }, []);

  const expandLive = useCallback((id: string, nextEntryId: string): void => {
    setGroupId(id);
    setEntryId(nextEntryId);
  }, []);

  const value = useMemo<ToolAccordionApi>(() => ({
    isGroupOpen,
    isEntryOpen,
    toggleGroup,
    toggleEntry,
    expandLive
  }), [expandLive, isEntryOpen, isGroupOpen, toggleEntry, toggleGroup]);

  return (
    <ToolAccordionContext.Provider value={value}>
      {children}
    </ToolAccordionContext.Provider>
  );
}

export function useToolAccordion(): ToolAccordionApi {
  const ctx = useContext(ToolAccordionContext);
  if (ctx === null) {
    throw new Error("useToolAccordion() must be used inside ToolAccordionProvider.");
  }
  return ctx;
}
