import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { useLoadingVisibility } from "../shell/use-loading-visibility";
import {
  deriveFileManagerSurfaceModel
} from "./surface-model";
import {
  FileManagerSurfaceView
} from "./surface-view";
import { FileManagerToolbarContent } from "./surface-toolbar";
import type {
  FileManagerAppState,
  FileManagerChooserMode,
  FileManagerModel,
  FileManagerSearchIndexModel,
  FileManagerSurfaceLabels
} from "./types";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type { LyraDesktopApi, SearchIndexStatusResponse } from "../../../shared/desktop-bridge";
import type { FileManagerFavorite } from "../../../shared/file-manager";
import { useFileManagerSurfaceActions } from "./use-file-manager-surface-actions";

export type FileManagerSurfaceProps = {
  readonly desktopApi?: LyraDesktopApi | null;
  readonly state: FileManagerAppState | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly model: FileManagerModel;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenFavorite?: (favorite: FileManagerFavorite) => void;
  readonly chooser?: FileManagerChooserMode | null;
};

const SEARCH_INDEX_ACTIVE_POLL_INTERVAL_MS = 2_000;
const SEARCH_INDEX_READY_POLL_INTERVAL_MS = 15_000;

type FileManagerSearchIndexRuntime = FileManagerSearchIndexModel & {
  readonly rebuildSearchIndex: () => Promise<void>;
};

const useFileManagerSearchIndexStatus = (
  desktopApi: LyraDesktopApi | null | undefined
): FileManagerSearchIndexRuntime => {
  const searchApi = desktopApi?.search;
  const [status, setStatus] = useState<SearchIndexStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (searchApi === undefined) {
      setStatus(null);
      setErrorMessage(undefined);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const poll = async (): Promise<void> => {
      let nextState: SearchIndexStatusResponse["state"] | undefined;
      try {
        const nextStatus = await searchApi.readIndexStatus();
        nextState = nextStatus.state;
        if (cancelled) {
          return;
        }
        setStatus(nextStatus);
        setErrorMessage(undefined);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void poll();
          }, nextState === "ready" ? SEARCH_INDEX_READY_POLL_INTERVAL_MS : SEARCH_INDEX_ACTIVE_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [searchApi]);

  const rebuildSearchIndex = useCallback(async (): Promise<void> => {
    if (searchApi === undefined || rebuilding) {
      return;
    }
    setRebuilding(true);
    try {
      const response = await searchApi.rebuildIndex();
      setStatus(response.status);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRebuilding(false);
    }
  }, [rebuilding, searchApi]);

  return useMemo(
    () => ({
      status,
      errorMessage,
      rebuilding,
      rebuildSearchIndex
    }),
    [errorMessage, rebuildSearchIndex, rebuilding, status]
  );
};

const FileManagerTitlebarBridge = ({
  renderModel,
  labels,
  actions,
  searchIndex
}: {
  readonly renderModel: ReturnType<typeof deriveFileManagerSurfaceModel>;
  readonly labels: FileManagerSurfaceLabels;
  readonly actions: NonNullable<ReturnType<typeof useFileManagerSurfaceActions>>;
  readonly searchIndex: FileManagerSearchIndexModel;
}) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <FileManagerToolbarContent
          renderModel={renderModel}
          labels={labels}
          actions={actions}
          searchIndex={searchIndex}
        />
      )
    }),
    [actions, labels, renderModel, searchIndex]
  );
  useWorkbenchTitlebarContribution(contribution);
  return null;
};

export const FileManagerSurface = ({
  desktopApi,
  state,
  labels,
  model,
  onOpenFile,
  onOpenFavorite,
  chooser
}: FileManagerSurfaceProps) => {
  const isLoading = state?.status === "loading";
  const showLoadingSkeleton = useLoadingVisibility(isLoading, {
    showDelayMs: 120,
    minVisibleMs: 180
  });
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const [pageKindOverride, setPageKindOverride] = useState<"favorites" | null>(null);
  const searchIndex = useFileManagerSearchIndexStatus(desktopApi);

  const effectiveViewKind = pageKindOverride ?? state?.viewKind;
  const renderModel = useMemo(
    () =>
      state === null
        ? null
        : deriveFileManagerSurfaceModel(
          state,
          chooser,
          showLoadingSkeleton,
          effectiveViewKind
        ),
    [chooser, effectiveViewKind, showLoadingSkeleton, state]
  );

  const actions = useFileManagerSurfaceActions({
    state,
    model,
    onOpenFile,
    ...(onOpenFavorite === undefined ? {} : { onOpenFavorite }),
    ...(chooser === undefined ? {} : { chooser }),
    renderModel,
    searchIndex,
    setPageKindOverride,
    dragPreviewRef
  });

  useEffect(
    () => () => {
      const currentPreview = dragPreviewRef.current;
      if (currentPreview !== null) {
        dragPreviewRef.current = null;
        currentPreview.remove();
      }
    },
    []
  );

  useEffect(() => {
    setPageKindOverride(null);
  }, [state?.instanceId]);

  if (state === null || renderModel === null || actions === null) {
    return null;
  }

  return (
    <>
      <FileManagerTitlebarBridge
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
      <FileManagerSurfaceView
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
    </>
  );
};
