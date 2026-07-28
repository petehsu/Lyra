import { useCallback, useState } from "react";

import type { AgentMcpServer } from "../../../shared/desktop-bridge";
import type { SettingsAiModel } from "./types";

export type McpEditDraft = {
  readonly args: string;
  readonly command: string;
  readonly enabled: boolean;
  readonly env: string;
  readonly headers: string;
  readonly name: string;
  readonly transport: AgentMcpServer["transport"]["kind"];
  readonly url: string;
};

export const fuzzyScore = (text: string, query: string): number => {
  if (query.length === 0) {
    return 0;
  }
  let textIndex = 0;
  let score = 0;
  let streak = 0;
  for (const queryChar of query) {
    const foundIndex = text.indexOf(queryChar, textIndex);
    if (foundIndex < 0) {
      return Number.NEGATIVE_INFINITY;
    }
    streak = foundIndex === textIndex ? streak + 1 : 1;
    score += 4 + streak * 3 - Math.min(foundIndex - textIndex, 8);
    textIndex = foundIndex + 1;
  }
  return score;
};

export const mcpTransportText = (server: AgentMcpServer): string =>
  server.transportSummary
  ?? (server.transport.kind === "stdio"
    ? [server.transport.command, ...server.transport.args].filter(Boolean).join(" ")
    : server.transport.url);

const mcpSearchText = (server: AgentMcpServer): string =>
  [
    server.id,
    server.name,
    server.state,
    mcpTransportText(server),
    ...(server.tools ?? []).flatMap((tool) => [tool.name, tool.description ?? ""]),
  ].join(" ").toLocaleLowerCase();

const formatMcpMap = (value: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(value ?? {})
    .map(([key, entryValue]) => `${key}=${entryValue}`)
    .join("\n");

const mcpDraftFromServer = (server: AgentMcpServer): McpEditDraft => {
  if (server.transport.kind === "stdio") {
    return {
      args: server.transport.args.join(" "),
      command: server.transport.command,
      enabled: server.enabled,
      env: formatMcpMap(server.transport.env),
      headers: "",
      name: server.name,
      transport: "stdio",
      url: "",
    };
  }
  return {
    args: "",
    command: "",
    enabled: server.enabled,
    env: "",
    headers: formatMcpMap(server.transport.headers),
    name: server.name,
    transport: server.transport.kind,
    url: server.transport.url,
  };
};

export const mcpDraftReady = (draft: McpEditDraft): boolean =>
  draft.name.trim().length > 0
  && (draft.transport === "stdio"
    ? draft.command.trim().length > 0
    : draft.url.trim().length > 0);

export const useSettingsAiMcpViewModel = (model: SettingsAiModel) => {
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<McpEditDraft | null>(null);
  const servers = model.agentMcpCatalog?.servers ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredServers = normalizedQuery.length === 0
    ? [...servers]
    : servers
      .map((server) => ({ server, score: fuzzyScore(mcpSearchText(server), normalizedQuery) }))
      .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.score - left.score || left.server.name.localeCompare(right.server.name))
      .map((entry) => entry.server);

  const runMcpOperation = useCallback(async (
    pendingId: string,
    operation: () => Promise<void> | void,
  ): Promise<void> => {
    setPendingIds((current) => new Set(current).add(pendingId));
    try {
      await operation();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(pendingId);
        return next;
      });
    }
  }, []);

  const addServer = useCallback((): void => {
    const input = query.trim();
    if (input.length === 0) return;
    void runMcpOperation("input", async () => {
      await model.upsertAgentMcpServer?.({ input });
      setQuery("");
    });
  }, [model.upsertAgentMcpServer, query, runMcpOperation]);

  const editServer = useCallback((server: AgentMcpServer): void => {
    setEditingServerId(server.id);
    setEditingDraft(mcpDraftFromServer(server));
  }, []);

  const cancelEditServer = useCallback((): void => {
    setEditingServerId(null);
    setEditingDraft(null);
  }, []);

  const saveEditedServer = useCallback((server: AgentMcpServer): void => {
    if (editingDraft === null || !mcpDraftReady(editingDraft)) return;
    void runMcpOperation(`server:${server.id}`, async () => {
      await model.upsertAgentMcpServer?.(editingDraft.transport === "stdio"
        ? {
          serverId: server.id,
          name: editingDraft.name,
          command: editingDraft.command,
          args: editingDraft.args,
          env: editingDraft.env,
          enabled: editingDraft.enabled,
        }
        : {
          serverId: server.id,
          name: editingDraft.name,
          transport: editingDraft.transport,
          url: editingDraft.url,
          headers: editingDraft.headers,
          enabled: editingDraft.enabled,
        });
      cancelEditServer();
    });
  }, [cancelEditServer, editingDraft, model.upsertAgentMcpServer, runMcpOperation]);

  const toggleServer = useCallback((server: AgentMcpServer, active: boolean): void => {
    void runMcpOperation(`server:${server.id}`, async () => {
      if (active) {
        await model.connectAgentMcpServer?.({ serverId: server.id });
      } else {
        await model.disconnectAgentMcpServer?.({ serverId: server.id });
      }
    });
  }, [model.connectAgentMcpServer, model.disconnectAgentMcpServer, runMcpOperation]);

  const removeServer = useCallback((server: AgentMcpServer): void => {
    void runMcpOperation(`server:${server.id}`, async () => {
      await model.removeAgentMcpServer?.({ serverId: server.id });
    });
  }, [model.removeAgentMcpServer, runMcpOperation]);

  return {
    addServer,
    cancelEditServer,
    editServer,
    editingDraft,
    editingServerId,
    filteredServers,
    pendingIds,
    query,
    removeServer,
    saveEditedServer,
    servers,
    setEditingDraft,
    setQuery,
    toggleServer,
  };
};
