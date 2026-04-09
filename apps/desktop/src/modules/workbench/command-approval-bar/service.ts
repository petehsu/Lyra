import type {
  CommandApprovalRequest,
  CommandApprovalResponse,
  CommandApprovalBarState,
} from './types';

const APPROVAL_REQUEST_EVENT = 'command_approval_request';
const APPROVAL_RESPONSE_EVENT = 'command_approval_response';

type Handler = (...args: any[]) => void;
const handlers = new Map<string, Set<Handler>>();

function emit(event: string, ...args: any[]) {
  handlers.get(event)?.forEach((fn) => fn(...args));
}

function on(event: string, fn: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
}

function off(event: string, fn: Handler) {
  handlers.get(event)?.delete(fn);
}

let state: CommandApprovalBarState = {
  pendingRequest: null,
  isVisible: false,
  isExpanded: false,
};

const listeners = new Set<(state: CommandApprovalBarState) => void>();

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function useCommandApprovalBar(): {
  state: CommandApprovalBarState;
  subscribe: (listener: (state: CommandApprovalBarState) => void) => () => void;
  handleDecision: (response: CommandApprovalResponse) => void;
} {
  const subscribe = (listener: (state: CommandApprovalBarState) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const handleDecision = (response: CommandApprovalResponse) => {
    emit(APPROVAL_RESPONSE_EVENT, response);
    state = {
      pendingRequest: null,
      isVisible: false,
      isExpanded: false,
    };
    notify();
  };

  return { state, subscribe, handleDecision };
}

/** Called when backend sends an approval request */
export function showApprovalRequest(request: CommandApprovalRequest): void {
  state = {
    pendingRequest: request,
    isVisible: true,
    isExpanded: false,
  };
  notify();
  emit(APPROVAL_REQUEST_EVENT, request);
}

/** Clear the approval bar (e.g., on timeout or cancellation) */
export function clearApprovalRequest(): void {
  state = {
    pendingRequest: null,
    isVisible: false,
    isExpanded: false,
  };
  notify();
}

/** Listen for approval requests from the backend */
export function onApprovalRequest(
  handler: (request: CommandApprovalRequest) => void,
): () => void {
  on(APPROVAL_REQUEST_EVENT, handler);
  return () => {
    off(APPROVAL_REQUEST_EVENT, handler);
  };
}

/** Wait for a user decision on a specific request */
export function waitForDecision(requestId: string): Promise<CommandApprovalResponse> {
  return new Promise((resolve) => {
    const handler = (response: CommandApprovalResponse) => {
      if (response.requestId === requestId) {
        off(APPROVAL_RESPONSE_EVENT, handler);
        resolve(response);
      }
    };
    on(APPROVAL_RESPONSE_EVENT, handler);
  });
}
