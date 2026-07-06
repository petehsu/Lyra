// Host capability handler that lets the Rust runtime read the CodeGraph
// embedding toggle via the host dispatcher callback
// `agent.readCodeGraphEmbeddingEnabled`. Mirrors the host-persona-context
// pattern: the Rust runtime calls back to the TS host process per-turn to
// read this value, then threads it into the CodeGraphEngine.

import type { AgentCodeGraphEmbeddingController } from "./codegraph-embedding-toggle";

export type CodeGraphEmbeddingContextPayload = {
  readonly enabled: boolean;
};

export const createCodeGraphEmbeddingHandlers = (
  controller: AgentCodeGraphEmbeddingController
): {
  readonly "agent.readCodeGraphEmbeddingEnabled": () => Promise<CodeGraphEmbeddingContextPayload>;
} => ({
  "agent.readCodeGraphEmbeddingEnabled": async () => ({
    enabled: controller.read()
  })
});