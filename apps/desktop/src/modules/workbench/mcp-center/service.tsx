import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  McpRuntimeEvent,
  McpScope,
  McpUpdateServerRequest
} from "../../../shared/mcp";
import type {
  McpCenterDraft,
  McpCenterEnvironmentDraft,
  McpCenterModel,
  McpCenterStatusFilter,
  UseMcpCenterModelOptions
} from "./types";
import {
  createEmptyDraft,
  createPresetDraft,
  draftFromServer,
  parseDraftRaw,
  serializeDraftToPayload,
  serializeDraftToRaw
} from "./service-draft-codec";
import { createDraftId, createInitialState } from "./service-model-state";
import { resolveServerRequest } from "./service-server-request";

export const useMcpCenterModel = ({
  desktopApi,
  projectHintPath
}: UseMcpCenterModelOptions): McpCenterModel => {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback(async (): Promise<void> => {
    if (desktopApi?.mcp === undefined) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: "MCP desktop bridge is unavailable."
      }));
      return;
    }

    const requestVersion = loadVersionRef.current + 1;
    loadVersionRef.current = requestVersion;

    setState((current) => ({
      ...current,
      status: "loading",
      errorMessage: null
    }));

    try {
      const [catalog, globalServers, effectiveConfig] = await Promise.all([
        desktopApi.mcp.readCatalog(),
        desktopApi.mcp.readServers({
          scope: "global",
          ...(projectHintPath === undefined ? {} : { projectRoot: projectHintPath })
        }),
        desktopApi.mcp.readEffectiveServers(
          projectHintPath === undefined ? undefined : { projectRoot: projectHintPath }
        )
      ]);
      const projectServers =
        effectiveConfig.resolvedProjectRoot === undefined
          ? []
          : await desktopApi.mcp.readServers({
              scope: "project",
              projectRoot: effectiveConfig.resolvedProjectRoot
            });

      if (loadVersionRef.current !== requestVersion) {
        return;
      }

      setState((current) => {
        const selectedServerId =
          current.selectedServerId !== null &&
          effectiveConfig.servers.some((server) => server.id === current.selectedServerId)
            ? current.selectedServerId
            : effectiveConfig.servers[0]?.id;
        const selectedCatalogId =
          current.selectedCatalogId !== null &&
          catalog.some((item) => item.id === current.selectedCatalogId)
            ? current.selectedCatalogId
            : catalog[0]?.id;

        return {
          ...current,
          status: "ready",
          catalog,
          globalServers,
          projectServers,
          effectiveConfig,
          selectedServerId: selectedServerId ?? null,
          selectedCatalogId: selectedCatalogId ?? null,
          preferredScope:
            effectiveConfig.resolvedProjectRoot === undefined &&
            current.preferredScope === "project"
              ? "global"
              : current.preferredScope,
          errorMessage: null
        };
      });
    } catch (error) {
      if (loadVersionRef.current !== requestVersion) {
        return;
      }
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, projectHintPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (desktopApi?.mcp === undefined) {
      return;
    }
    return desktopApi.mcp.onEvent((event: McpRuntimeEvent) => {
      setState((current) => {
        if (event.kind === "runtime-status") {
          return {
            ...current,
            runtimeByServerId: {
              ...current.runtimeByServerId,
              [event.status.serverId]: event.status
            }
          };
        }
        if (event.kind === "validation") {
          return {
            ...current,
            validationByServerId: {
              ...current.validationByServerId,
              [event.result.serverId]: event.result
            }
          };
        }
        if (event.kind === "introspection") {
          return {
            ...current,
            introspectionByServerId: {
              ...current.introspectionByServerId,
              [event.snapshot.serverId]: event.snapshot
            }
          };
        }
        return current;
      });
    });
  }, [desktopApi]);

  const selectServer = useCallback((serverId: string): void => {
    setState((current) => ({
      ...current,
      selectedServerId: serverId,
      panelMode: "details"
    }));
  }, []);

  const selectCatalogItem = useCallback((catalogId: string): void => {
    setState((current) => ({
      ...current,
      selectedCatalogId: catalogId,
      panelMode: "catalog",
      presetDraft:
        current.presetDraft?.templateId === catalogId ? current.presetDraft : null
    }));
  }, []);

  const setPreferredScope = useCallback((scope: McpScope): void => {
    setState((current) => ({
      ...current,
      preferredScope:
        scope === "project" && current.effectiveConfig.resolvedProjectRoot === undefined
          ? "global"
          : scope
    }));
  }, []);

  const setStatusFilter = useCallback((filter: McpCenterStatusFilter): void => {
    setState((current) => ({
      ...current,
      statusFilter: filter
    }));
  }, []);

  const openCatalog = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "catalog",
      selectedCatalogId: current.selectedCatalogId ?? current.catalog[0]?.id ?? null,
      presetDraft: null,
      errorMessage: null
    }));
  }, []);

  const openPreset = useCallback((catalogId: string): void => {
    setState((current) => {
      const catalogItem = current.catalog.find((item) => item.id === catalogId);
      if (catalogItem?.quickSetup === undefined) {
        return current;
      }
      const defaults = Object.fromEntries(
        catalogItem.quickSetup.fields.map((field) => [
          field.id,
          field.defaultValue ??
            (field.preferProjectRoot === true
              ? current.effectiveConfig.resolvedProjectRoot ?? ""
              : "")
        ])
      );
      return {
        ...current,
        panelMode: "catalog",
        selectedCatalogId: catalogId,
        presetDraft: createPresetDraft(
          catalogId,
          current.preferredScope === "project" &&
            current.effectiveConfig.resolvedProjectRoot === undefined
            ? "global"
            : current.preferredScope,
          defaults
        ),
        errorMessage: null
      };
    });
  }, []);

  const openCustom = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "custom",
      draft: createEmptyDraft(current.preferredScope, "custom"),
      presetDraft: null,
      errorMessage: null
    }));
  }, []);

  const openEdit = useCallback((serverId: string): void => {
    const server = stateRef.current.effectiveConfig.servers.find(
      (entry) => entry.id === serverId
    );
    if (server === undefined) {
      return;
    }
    setState((current) => ({
      ...current,
      selectedServerId: serverId,
      panelMode: "edit",
      draft: draftFromServer(server),
      presetDraft: null,
      errorMessage: null
    }));
  }, []);

  const closePanelMode = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "details",
      draft: null,
      presetDraft: null,
      errorMessage: null
    }));
  }, []);

  const updateDraftField = useCallback(
    <K extends keyof McpCenterDraft>(field: K, value: McpCenterDraft[K]): void => {
      setState((current) => {
        if (current.draft === null) {
          return current;
        }
        const nextDraft = {
          ...current.draft,
          [field]: value
        } as McpCenterDraft;
        return {
          ...current,
          draft:
            nextDraft.advancedMode === false
              ? nextDraft
              : {
                  ...nextDraft,
                  rawValue: serializeDraftToRaw(nextDraft)
                },
          errorMessage: null
        };
      });
    },
    []
  );

  const addDraftEnvironment = useCallback((): void => {
    setState((current) => {
      if (current.draft === null) {
        return current;
      }
      const nextDraft: McpCenterDraft = {
        ...current.draft,
        environment: [
          ...current.draft.environment,
          {
            id: createDraftId(),
            key: "",
            mode: "plain",
            value: ""
          }
        ]
      };
      return {
        ...current,
        draft:
          nextDraft.advancedMode === false
            ? nextDraft
            : {
                ...nextDraft,
                rawValue: serializeDraftToRaw(nextDraft)
              }
      };
    });
  }, []);

  const updateDraftEnvironment = useCallback(
    (
      id: string,
      field: "key" | "mode" | "value",
      value: string
    ): void => {
      setState((current) => {
        if (current.draft === null) {
          return current;
        }
        const nextDraft: McpCenterDraft = {
          ...current.draft,
          environment: current.draft.environment.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  [field]:
                    field === "mode"
                      ? (value as McpCenterEnvironmentDraft["mode"])
                      : value
                }
              : entry
          )
        };
        return {
          ...current,
          draft:
            nextDraft.advancedMode === false
              ? nextDraft
              : {
                  ...nextDraft,
                  rawValue: serializeDraftToRaw(nextDraft)
                },
          errorMessage: null
        };
      });
    },
    []
  );

  const removeDraftEnvironment = useCallback((id: string): void => {
    setState((current) => {
      if (current.draft === null) {
        return current;
      }
      const nextDraft: McpCenterDraft = {
        ...current.draft,
        environment: current.draft.environment.filter((entry) => entry.id !== id)
      };
      return {
        ...current,
        draft:
          nextDraft.advancedMode === false
            ? nextDraft
            : {
                ...nextDraft,
                rawValue: serializeDraftToRaw(nextDraft)
              }
      };
    });
  }, []);

  const toggleDraftAdvanced = useCallback((): void => {
    setState((current) => {
      if (current.draft === null) {
        return current;
      }
      if (current.draft.advancedMode) {
        try {
          const parsed = parseDraftRaw(
            current.draft.rawValue,
            current.draft.mode,
            current.draft.scope,
            current.draft.serverId ?? undefined
          );
          return {
            ...current,
            draft: {
              ...parsed,
              advancedMode: false,
              rawValue: current.draft.rawValue
            },
            errorMessage: null
          };
        } catch (error) {
          return {
            ...current,
            errorMessage: error instanceof Error ? error.message : String(error)
          };
        }
      }

      return {
        ...current,
        draft: {
          ...current.draft,
          advancedMode: true,
          rawValue: serializeDraftToRaw(current.draft)
        },
        errorMessage: null
      };
    });
  }, []);

  const updatePresetField = useCallback((fieldId: string, value: string): void => {
    setState((current) => {
      if (current.presetDraft === null) {
        return current;
      }
      if (fieldId === "title") {
        return {
          ...current,
          presetDraft: {
            ...current.presetDraft,
            title: value
          },
          errorMessage: null
        };
      }
      if (fieldId === "enabled") {
        return {
          ...current,
          presetDraft: {
            ...current.presetDraft,
            enabled: value === "true"
          },
          errorMessage: null
        };
      }
      if (fieldId === "autoStart") {
        return {
          ...current,
          presetDraft: {
            ...current.presetDraft,
            autoStart: value === "true"
          },
          errorMessage: null
        };
      }
      return {
        ...current,
        presetDraft: {
          ...current.presetDraft,
          values: {
            ...current.presetDraft.values,
            [fieldId]: value
          }
        },
        errorMessage: null
      };
    });
  }, []);

  const savePresetInstall = useCallback(async (): Promise<void> => {
    if (desktopApi?.mcp === undefined) {
      return;
    }
    const currentPresetDraft = stateRef.current.presetDraft;
    if (currentPresetDraft === null) {
      return;
    }

    const catalogItem = stateRef.current.catalog.find(
      (item) => item.id === currentPresetDraft.templateId
    );
    const missingRequiredField = catalogItem?.quickSetup?.fields.find((field) => {
      if (field.required === false) {
        return false;
      }
      const currentValue = currentPresetDraft.values[field.id]?.trim();
      if ((currentValue?.length ?? 0) > 0) {
        return false;
      }
      return !(
        field.preferProjectRoot === true &&
        stateRef.current.effectiveConfig.resolvedProjectRoot !== undefined
      );
    });

    if (missingRequiredField !== undefined) {
      setState((current) => ({
        ...current,
        errorMessage: `Missing required preset field: ${missingRequiredField.id}`
      }));
      return;
    }

    try {
      const nextServer = await desktopApi.mcp.installTemplate({
        templateId: currentPresetDraft.templateId,
        scope: currentPresetDraft.scope,
        ...(stateRef.current.effectiveConfig.resolvedProjectRoot === undefined
          ? {}
          : { projectRoot: stateRef.current.effectiveConfig.resolvedProjectRoot }),
        ...(currentPresetDraft.title.trim().length === 0
          ? {}
          : { title: currentPresetDraft.title.trim() }),
        setupValues: currentPresetDraft.values,
        enabled: currentPresetDraft.enabled,
        autoStart: currentPresetDraft.autoStart
      });

      await load();
      setState((current) => ({
        ...current,
        panelMode: "details",
        presetDraft: null,
        selectedServerId: nextServer.id,
        errorMessage: null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, load]);

  const resolveServer = useCallback((serverId: string) => {
    return resolveServerRequest(stateRef.current.effectiveConfig.servers, serverId);
  }, []);

  const saveDraft = useCallback(async (): Promise<void> => {
    if (desktopApi?.mcp === undefined) {
      return;
    }
    const currentDraft = stateRef.current.draft;
    if (currentDraft === null) {
      return;
    }

    try {
      const normalizedDraft = currentDraft.advancedMode
        ? parseDraftRaw(
            currentDraft.rawValue,
            currentDraft.mode,
            currentDraft.scope,
            currentDraft.serverId ?? undefined
          )
        : currentDraft;
      const payload = serializeDraftToPayload(normalizedDraft);

      const nextServer =
        normalizedDraft.mode === "edit" && normalizedDraft.serverId !== null
          ? await desktopApi.mcp.updateServer({
              serverId: normalizedDraft.serverId,
              ...payload
            } satisfies McpUpdateServerRequest)
          : await desktopApi.mcp.createServer(payload);

      await load();
      setState((current) => ({
        ...current,
        panelMode: "details",
        draft: null,
        selectedServerId: nextServer.id,
        errorMessage: null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, load]);

  const installTemplate = useCallback(
    async (
      templateId: string,
      setupValues?: Readonly<Record<string, string>>,
      title?: string
    ): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const nextServer = await desktopApi.mcp.installTemplate({
          templateId,
          scope: stateRef.current.preferredScope,
          ...(stateRef.current.effectiveConfig.resolvedProjectRoot === undefined
            ? {}
            : { projectRoot: stateRef.current.effectiveConfig.resolvedProjectRoot }),
          ...(setupValues === undefined ? {} : { setupValues }),
          ...(title === undefined || title.trim().length === 0 ? {} : { title: title.trim() })
        });
        await load();
        setState((current) => ({
          ...current,
          panelMode: "details",
          selectedServerId: nextServer.id,
          errorMessage: null
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, load]
  );

  const validateServer = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        const result = await desktopApi.mcp.validateServer(request);
        setState((current) => ({
          ...current,
          validationByServerId: {
            ...current.validationByServerId,
            [result.serverId]: result
          },
          errorMessage: null
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, resolveServer]
  );

  const startServer = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        await desktopApi.mcp.startServer(request);
        await load();
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, load, resolveServer]
  );

  const stopServer = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        await desktopApi.mcp.stopServer(request);
        await load();
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, load, resolveServer]
  );

  const restartServer = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        await desktopApi.mcp.restartServer(request);
        await load();
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, load, resolveServer]
  );

  const deleteServer = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        await desktopApi.mcp.deleteServer(request);
        await load();
        setState((current) => ({
          ...current,
          selectedServerId:
            current.selectedServerId === serverId ? null : current.selectedServerId,
          panelMode: "details",
          errorMessage: null
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, load, resolveServer]
  );

  const readServerIntrospection = useCallback(
    async (serverId: string): Promise<void> => {
      if (desktopApi?.mcp === undefined) {
        return;
      }
      try {
        const { request } = resolveServer(serverId);
        const snapshot = await desktopApi.mcp.readServerIntrospection(request);
        setState((current) => ({
          ...current,
          introspectionByServerId: {
            ...current.introspectionByServerId,
            [snapshot.serverId]: snapshot
          },
          errorMessage: null
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    },
    [desktopApi, resolveServer]
  );

  return useMemo<McpCenterModel>(
    () => ({
      state,
      load,
      selectServer,
      selectCatalogItem,
      setPreferredScope,
      setStatusFilter,
      openCatalog,
      openPreset,
      openCustom,
      openEdit,
      closePanelMode,
      updatePresetField,
      savePresetInstall,
      updateDraftField,
      addDraftEnvironment,
      updateDraftEnvironment,
      removeDraftEnvironment,
      toggleDraftAdvanced,
      saveDraft,
      installTemplate,
      validateServer,
      startServer,
      stopServer,
      restartServer,
      deleteServer,
      readServerIntrospection
    }),
    [
      addDraftEnvironment,
      closePanelMode,
      deleteServer,
      installTemplate,
      load,
      openCatalog,
      openPreset,
      openCustom,
      openEdit,
      readServerIntrospection,
      removeDraftEnvironment,
      restartServer,
      saveDraft,
      savePresetInstall,
      selectCatalogItem,
      selectServer,
      setPreferredScope,
      setStatusFilter,
      startServer,
      state,
      stopServer,
      toggleDraftAdvanced,
      updatePresetField,
      updateDraftEnvironment,
      updateDraftField,
      validateServer
    ]
  );
};
