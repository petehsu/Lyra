// Process-global CodeGraph embedding toggle. Mirrors the act-cache-toggle
// pattern but controls whether the Rust runtime-embedded CodeGraph engine
// loads the ONNX embedding model (fastembed BGE-Small / Jina-Code) for
// semantic symbol search. Default off — when off, the engine runs in
// graph-only mode (structural queries only), which is the current behavior.
//
// The toggle is read by the Rust runtime via the host capability callback
// `agent.readCodeGraphEmbeddingEnabled` (see codegraph-embedding-context.ts).
// It is not persisted across restarts — like follow mode and ActCache, it
// defaults off and is controlled at runtime via the settings panel IPC.

let codegraphEmbeddingEnabled = false;

export const readCodeGraphEmbeddingEnabled = (): boolean => codegraphEmbeddingEnabled;

export const writeCodeGraphEmbeddingEnabled = (enabled: boolean): void => {
  codegraphEmbeddingEnabled = enabled === true;
};

export type AgentCodeGraphEmbeddingController = {
  readonly read: typeof readCodeGraphEmbeddingEnabled;
  readonly set: typeof writeCodeGraphEmbeddingEnabled;
};

export const codeGraphEmbeddingController: AgentCodeGraphEmbeddingController = {
  read: readCodeGraphEmbeddingEnabled,
  set: writeCodeGraphEmbeddingEnabled
};