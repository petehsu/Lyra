import { useEffect, useMemo, useState } from "react";

import type {
  AgentArtifactContent,
  AgentReadArtifactRequest,
} from "./agent-ui-types";
import type { PatchProposalEvent } from "./patch-artifact";

export type ReadPatchArtifact = (
  request: AgentReadArtifactRequest
) => Promise<AgentArtifactContent>;

type PatchArtifactLoadState =
  | {
    readonly status: "idle" | "loading";
    readonly artifact: null;
    readonly error: null;
  }
  | {
    readonly status: "ready";
    readonly artifact: AgentArtifactContent;
    readonly error: null;
  }
  | {
    readonly status: "error";
    readonly artifact: null;
    readonly error: string;
  };

const artifactCache = new Map<string, AgentArtifactContent>();
const pendingArtifactReads = new Map<string, Promise<AgentArtifactContent>>();

const requestFromProposal = (
  proposal: PatchProposalEvent
): AgentReadArtifactRequest | null => {
  if (proposal.artifactId !== null) {
    return {
      sessionId: proposal.sessionId,
      artifactId: proposal.artifactId,
    };
  }
  const patchRef = proposal.patchRef ?? proposal.resultRef;
  if (patchRef === null) {
    return null;
  }
  return {
    sessionId: proposal.sessionId,
    patchRef,
  };
};

const requestKey = (request: AgentReadArtifactRequest): string =>
  `${request.sessionId}:${request.artifactId ?? request.patchRef ?? ""}`;

export const usePatchArtifact = ({
  proposal,
  enabled,
  readArtifact,
}: {
  readonly proposal: PatchProposalEvent;
  readonly enabled: boolean;
  readonly readArtifact?: ReadPatchArtifact | undefined;
}): PatchArtifactLoadState => {
  const request = useMemo(
    () => requestFromProposal(proposal),
    [proposal.artifactId, proposal.patchRef, proposal.resultRef, proposal.sessionId]
  );
  const key = request === null ? null : requestKey(request);
  const [state, setState] = useState<PatchArtifactLoadState>(() => {
    if (key !== null && artifactCache.has(key)) {
      return {
        status: "ready",
        artifact: artifactCache.get(key)!,
        error: null,
      };
    }
    return {
      status: "idle",
      artifact: null,
      error: null,
    };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (request === null || key === null) {
      setState({
        status: "error",
        artifact: null,
        error: "Patch artifact reference is missing",
      });
      return;
    }
    const cached = artifactCache.get(key);
    if (cached !== undefined) {
      setState({
        status: "ready",
        artifact: cached,
        error: null,
      });
      return;
    }
    if (readArtifact === undefined) {
      setState({
        status: "error",
        artifact: null,
        error: "Patch artifact reader is unavailable",
      });
      return;
    }
    let disposed = false;
    setState({
      status: "loading",
      artifact: null,
      error: null,
    });
    const pending = pendingArtifactReads.get(key) ?? readArtifact(request);
    pendingArtifactReads.set(key, pending);
    void pending
      .then((artifact) => {
        artifactCache.set(key, artifact);
        if (!disposed) {
          setState({
            status: "ready",
            artifact,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState({
            status: "error",
            artifact: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (pendingArtifactReads.get(key) === pending) {
          pendingArtifactReads.delete(key);
        }
      });
    return () => {
      disposed = true;
    };
  }, [enabled, key, readArtifact, request]);

  return state;
};
