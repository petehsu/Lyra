import { useCallback, useRef } from "react";

import type {
  WorkbenchFeedbackEvent,
  WorkbenchFeedbackListener,
  WorkbenchFeedbackModel,
  WorkbenchFeedbackPublishRequest
} from "./types";

const createFeedbackId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `feedback-${crypto.randomUUID()}`;
  }
  return `feedback-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
};

export const useWorkbenchFeedbackModel = (): WorkbenchFeedbackModel => {
  const listenersRef = useRef<Set<WorkbenchFeedbackListener>>(new Set());

  const publishFeedback = useCallback((request: WorkbenchFeedbackPublishRequest): void => {
    const event: WorkbenchFeedbackEvent = {
      ...request,
      id: request.id ?? createFeedbackId(),
      createdAt: request.createdAt ?? Date.now()
    };
    for (const listener of listenersRef.current) {
      listener(event);
    }
  }, []);

  const subscribe = useCallback((listener: WorkbenchFeedbackListener): (() => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return {
    publishFeedback,
    subscribe
  };
};
