import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from "react";

type BrowserSharedState = {
  readonly inputValue: string;
  readonly address: string | null;
};

type BrowserViewStateStore = {
  readonly getSnapshot: (appId: string, externalAddress: string | null) => BrowserSharedState;
  readonly syncExternalAddress: (appId: string, externalAddress: string | null) => void;
  readonly setInputValue: (appId: string, externalAddress: string | null, value: string) => void;
  readonly setAddress: (appId: string, externalAddress: string | null, address: string | null) => void;
  readonly subscribe: (appId: string, listener: () => void) => () => void;
  readonly dispose: () => void;
};

const createFallbackState = (externalAddress: string | null): BrowserSharedState => ({
  inputValue: externalAddress ?? "",
  address: externalAddress
});

const createBrowserViewStateStore = (): BrowserViewStateStore => {
  const browserStates = new Map<string, BrowserSharedState>();
  const browserListeners = new Map<string, Set<() => void>>();

  const emit = (appId: string): void => {
    const listeners = browserListeners.get(appId);
    if (listeners === undefined) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const ensureListenerSet = (appId: string): Set<() => void> => {
    let listeners = browserListeners.get(appId);
    if (listeners === undefined) {
      listeners = new Set();
      browserListeners.set(appId, listeners);
    }
    return listeners;
  };

  const getSnapshot = (appId: string, externalAddress: string | null): BrowserSharedState => {
    const current = browserStates.get(appId);
    if (current !== undefined) {
      return current;
    }

    const next = createFallbackState(externalAddress);
    browserStates.set(appId, next);
    return next;
  };

  const syncExternalAddress = (appId: string, externalAddress: string | null): void => {
    const current = getSnapshot(appId, externalAddress);
    if (externalAddress === null) {
      return;
    }
    if (current.address === externalAddress && current.inputValue === externalAddress) {
      return;
    }
    browserStates.set(appId, {
      inputValue: externalAddress,
      address: externalAddress
    });
    emit(appId);
  };

  const setInputValue = (
    appId: string,
    externalAddress: string | null,
    value: string
  ): void => {
    const current = getSnapshot(appId, externalAddress);
    if (current.inputValue === value) {
      return;
    }
    browserStates.set(appId, {
      ...current,
      inputValue: value
    });
    emit(appId);
  };

  const setAddress = (
    appId: string,
    externalAddress: string | null,
    address: string | null
  ): void => {
    const current = getSnapshot(appId, externalAddress);
    if (current.address === address) {
      return;
    }
    browserStates.set(appId, {
      inputValue: current.inputValue,
      address
    });
    emit(appId);
  };

  const subscribe = (appId: string, listener: () => void): (() => void) => {
    const listeners = ensureListenerSet(appId);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        browserListeners.delete(appId);
      }
    };
  };

  const dispose = (): void => {
    browserStates.clear();
    browserListeners.clear();
  };

  return {
    getSnapshot,
    syncExternalAddress,
    setInputValue,
    setAddress,
    subscribe,
    dispose
  };
};

const AiComputerViewStateContext = createContext<BrowserViewStateStore | null>(null);

export const AiComputerViewStateProvider = ({
  sessionId,
  children
}: {
  readonly sessionId: string;
  readonly children: ReactNode;
}) => {
  const store = useMemo(() => createBrowserViewStateStore(), [sessionId]);

  useEffect(() => () => {
    store.dispose();
  }, [store]);

  return (
    <AiComputerViewStateContext.Provider value={store}>
      {children}
    </AiComputerViewStateContext.Provider>
  );
};

const useBrowserViewStateStore = (): BrowserViewStateStore => {
  const storeFromContext = useContext(AiComputerViewStateContext);
  const fallbackStoreRef = useRef<BrowserViewStateStore | null>(null);

  if (storeFromContext !== null) {
    return storeFromContext;
  }

  if (fallbackStoreRef.current === null) {
    fallbackStoreRef.current = createBrowserViewStateStore();
  }

  return fallbackStoreRef.current;
};

export const useAiComputerBrowserViewState = (
  appId: string,
  externalAddress: string | null
): {
  readonly state: BrowserSharedState;
  readonly setInputValue: (value: string) => void;
  readonly setAddress: (address: string | null) => void;
} => {
  const store = useBrowserViewStateStore();

  useEffect(() => {
    store.syncExternalAddress(appId, externalAddress);
  }, [appId, externalAddress, store]);

  const state = useSyncExternalStore(
    useCallback(
      (listener: () => void) => store.subscribe(appId, listener),
      [appId, store]
    ),
    () => store.getSnapshot(appId, externalAddress),
    () => store.getSnapshot(appId, externalAddress)
  );

  const setInputValue = useCallback((value: string): void => {
    store.setInputValue(appId, externalAddress, value);
  }, [appId, externalAddress, store]);

  const setAddress = useCallback((address: string | null): void => {
    store.setAddress(appId, externalAddress, address);
  }, [appId, externalAddress, store]);

  return {
    state,
    setInputValue,
    setAddress
  };
};
