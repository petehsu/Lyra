import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcService } from "../runtime-host-rpc/types";

const LOCAL_SEARCH_TOOL_SET_ID = "desktop.local_search";

type HostToolsSyncResult = {
  readonly acceptedCount: number;
  readonly droppedAsLyraOwnedCount: number;
  readonly droppedToolNames: readonly string[];
};

type HostToolInvocationPayload = {
  readonly toolName?: unknown;
  readonly arguments?: unknown;
  readonly context?: unknown;
};

type HostToolSideEffects = {
  readonly level: "read_only";
  readonly mutatesWorkspace: false;
  readonly mutatesMemory: false;
  readonly mutatesExternalSystems: false;
  readonly mutatesSessionState: false;
  readonly opensInteractiveSession: false;
  readonly readsNetwork: false;
};

type LocalSearchContentMode = "auto" | "disabled" | "required";

type LocalSearchToolConfig = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly method: "localSearch/search" | "localSearch/extractText";
  readonly defaultContentMode?: LocalSearchContentMode;
  readonly defaultKinds?: readonly ("file" | "directory")[];
};

type LocalSearchHostToolsBridge = {
  readonly dispose: () => void;
  readonly sync: () => Promise<void>;
};

const READ_ONLY_SIDE_EFFECTS: HostToolSideEffects = {
  level: "read_only",
  mutatesWorkspace: false,
  mutatesMemory: false,
  mutatesExternalSystems: false,
  mutatesSessionState: false,
  opensInteractiveSession: false,
  readsNetwork: false
};

const SEARCH_PROPERTIES = {
  query: { type: "string" },
  root: { type: "string" },
  roots: {
    type: "array",
    items: { type: "string" }
  },
  kind: { type: "string", enum: ["file", "directory"] },
  kinds: {
    type: "array",
    items: { type: "string", enum: ["file", "directory"] }
  },
  extension: { type: "string" },
  extensions: {
    type: "array",
    items: { type: "string" }
  },
  limit: { type: "number" },
  includeHidden: { type: "boolean" },
  includeVendor: { type: "boolean" },
  contentMode: { type: "string", enum: ["disabled", "auto", "required"] }
} as const;

const TOOL_CONFIGS: readonly LocalSearchToolConfig[] = [
  {
    name: "local.search",
    description: "Search local files by path, filename, extension, and indexed text snippets.",
    method: "localSearch/search",
    defaultContentMode: "auto",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: SEARCH_PROPERTIES,
      additionalProperties: false
    }
  },
  {
    name: "local.search_path",
    description: "Search local filenames, directory names, paths, and extensions without reading file contents.",
    method: "localSearch/search",
    defaultContentMode: "disabled",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: SEARCH_PROPERTIES,
      additionalProperties: false
    }
  },
  {
    name: "local.search_content",
    description: "Search text content in local files and return matching snippets.",
    method: "localSearch/search",
    defaultContentMode: "required",
    defaultKinds: ["file"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: SEARCH_PROPERTIES,
      additionalProperties: false
    }
  },
  {
    name: "local.extract_text",
    description: "Extract bounded plain text from a local file path.",
    method: "localSearch/extractText",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        maxBytes: { type: "number" }
      },
      additionalProperties: false
    }
  }
];

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const requireString = (record: Record<string, unknown>, key: string): string => {
  const value = readString(record[key]);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const readStringArray = (value: unknown): readonly string[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== undefined);
};

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readContentMode = (value: unknown): LocalSearchContentMode | undefined => {
  const mode = readString(value);
  return mode === "auto" || mode === "disabled" || mode === "required" ? mode : undefined;
};

const readKindArray = (
  record: Record<string, unknown>,
  defaults: readonly ("file" | "directory")[] = []
): readonly ("file" | "directory")[] => {
  const kind = readString(record.kind);
  const values = [
    ...readStringArray(record.kinds),
    ...(kind === undefined ? [] : [kind])
  ];
  const normalized = values.filter((value): value is "file" | "directory" =>
    value === "file" || value === "directory"
  );
  return normalized.length > 0 ? normalized : defaults;
};

const readExtensions = (record: Record<string, unknown>): readonly string[] => {
  const extension = readString(record.extension);
  return [
    ...readStringArray(record.extensions),
    ...(extension === undefined ? [] : [extension])
  ];
};

const readRoots = (
  record: Record<string, unknown>,
  context: Record<string, unknown>
): readonly string[] => {
  const root = readString(record.root);
  const explicit = [
    ...readStringArray(record.roots),
    ...(root === undefined ? [] : [root])
  ];
  if (explicit.length > 0) {
    return explicit;
  }
  const projectRoot = readString(context.projectRoot);
  const workspaceRoot = readString(context.workspaceRoot);
  return [
    ...(projectRoot === undefined ? [] : [projectRoot]),
    ...(workspaceRoot === undefined || workspaceRoot === projectRoot ? [] : [workspaceRoot])
  ];
};

const normalizeLimit = (value: unknown): number | undefined => {
  const number = readNumber(value);
  if (number === undefined) {
    return undefined;
  }
  return Math.max(1, Math.min(200, Math.round(number)));
};

const buildSearchParams = (
  config: LocalSearchToolConfig,
  payload: HostToolInvocationPayload
): Record<string, unknown> => {
  const args = asRecord(payload.arguments);
  const context = asRecord(payload.context);
  const limit = normalizeLimit(args.limit);
  const includeHidden = readBoolean(args.includeHidden);
  const includeVendor = readBoolean(args.includeVendor);
  const contentMode = readContentMode(args.contentMode) ?? config.defaultContentMode ?? "auto";
  return {
    query: requireString(args, "query"),
    roots: readRoots(args, context),
    kinds: readKindArray(args, config.defaultKinds),
    extensions: readExtensions(args),
    ...(limit === undefined ? {} : { limit }),
    ...(includeHidden === undefined ? {} : { includeHidden }),
    ...(includeVendor === undefined ? {} : { includeVendor }),
    contentMode
  };
};

const buildExtractTextParams = (payload: HostToolInvocationPayload): Record<string, unknown> => {
  const args = asRecord(payload.arguments);
  const maxBytes = readNumber(args.maxBytes);
  return {
    path: requireString(args, "path"),
    ...(maxBytes === undefined
      ? {}
      : { maxBytes: Math.max(1, Math.min(2_000_000, Math.round(maxBytes))) })
  };
};

const buildHostToolsPayload = () => ({
  toolSetId: LOCAL_SEARCH_TOOL_SET_ID,
  tools: TOOL_CONFIGS.map((config) => ({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: { type: "object" },
    executionMode: "serial" as const,
    approvalMode: "auto" as const,
    sideEffects: READ_ONLY_SIDE_EFFECTS,
    hostMethod: config.name
  }))
});

export const createLocalSearchHostToolsBridge = ({
  runtimeClient,
  runtimeHostRpc
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeHostRpc: RuntimeHostRpcService;
}): LocalSearchHostToolsBridge => {
  const requestLyraRuntime = async <T>(method: string, params: unknown): Promise<T> =>
    await runtimeClient.request<T>("lyra.runtime.request", { method, params });

  const disposers = TOOL_CONFIGS.map((config) =>
    runtimeHostRpc.registerHandler(config.name, async (rawPayload: unknown) => {
      const payload = asRecord(rawPayload) as HostToolInvocationPayload;
      if (config.method === "localSearch/extractText") {
        return await requestLyraRuntime(config.method, buildExtractTextParams(payload));
      }
      return await requestLyraRuntime(config.method, buildSearchParams(config, payload));
    })
  );

  return {
    dispose: () => {
      for (const dispose of disposers) {
        dispose();
      }
      void requestLyraRuntime("lyra/runtime/hostTools/remove", {
        toolSetId: LOCAL_SEARCH_TOOL_SET_ID
      }).catch(() => undefined);
    },
    sync: async () => {
      await requestLyraRuntime<HostToolsSyncResult>(
        "lyra/runtime/hostTools/sync",
        buildHostToolsPayload()
      );
    }
  };
};
