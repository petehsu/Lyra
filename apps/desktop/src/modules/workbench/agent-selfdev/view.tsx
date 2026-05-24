import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import type {
  AgentRuntimeEvent,
  AgentSelfDevStatusResponse,
  AgentSessionSnapshot
} from "../../../shared/desktop-bridge";
import { AgentChatApp } from "../ai-panel/agent-chat-demo/AgentChatApp";
import { setLocale, type Locale } from "../ai-panel/agent-chat-demo/core/i18n";
import { createDataProviderValue } from "../ai-panel/agent-chat-demo/data/createDataProviderValue";
import {
  agentSessionToChatMessages,
  agentSessionToSessionMeta,
  agentSessionToSidePanel,
  agentSessionToTodos,
  applyAgentRuntimeEventToSnapshot
} from "../agent-session-view-model";
import type {
  AgentSelfDevLabels,
  AgentSelfDevSurfaceProps,
  AgentSelfDevTarget
} from "./types";

type ChatState = {
  readonly session: AgentSessionSnapshot | null;
  readonly error: string | null;
};

type ChatAction =
  | { readonly type: "snapshot"; readonly snapshot: AgentSessionSnapshot }
  | { readonly type: "event"; readonly event: AgentRuntimeEvent }
  | { readonly type: "clear" }
  | { readonly type: "error"; readonly message: string };

const targetOptions: readonly AgentSelfDevTarget[] = [
  "agent-core",
  "desktop-gui",
  "validation",
  "general"
];

const targetLabel = (labels: AgentSelfDevLabels, target: AgentSelfDevTarget): string => {
  switch (target) {
    case "agent-core":
      return labels.targetAgentCore;
    case "desktop-gui":
      return labels.targetDesktopGui;
    case "validation":
      return labels.targetValidation;
    default:
      return labels.targetGeneral;
  }
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const reducer = (state: ChatState, action: ChatAction): ChatState => {
  if (action.type === "clear") return { session: null, error: null };
  if (action.type === "error") return { ...state, error: action.message };
  if (action.type === "snapshot") return { session: action.snapshot, error: null };
  const event = action.event;
  if (event.kind === "sessionSnapshot") {
    if (state.session !== null && event.snapshot.id !== state.session.id) {
      return state;
    }
    if (state.session === null && event.snapshot.sessionKind !== "selfdev") {
      return state;
    }
    return { session: event.snapshot, error: null };
  }
  if (state.session === null || !("sessionId" in event) || event.sessionId !== state.session.id) {
    return state;
  }
  if (event.kind === "turnFailed") {
    return {
      session: applyAgentRuntimeEventToSnapshot(state.session, event),
      error: event.message
    };
  }
  return {
    session: applyAgentRuntimeEventToSnapshot(state.session, event),
    error: state.error
  };
};

const useSelfDevChatData = (
  desktopApi: AgentSelfDevSurfaceProps["desktopApi"],
  session: AgentSessionSnapshot | null,
  dispatch: (action: ChatAction) => void
) => {
  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (desktopApi?.agent === undefined || session === null) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    await desktopApi.agent.sendSelfDevTurn({
      sessionId: session.id,
      text: trimmed
    });
  }, [desktopApi, session]);

  const cancelTurn = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || session === null) return;
    await desktopApi.agent.cancelTurn({ sessionId: session.id });
  }, [desktopApi, session]);

  return useMemo(
    () => createDataProviderValue({
      session: agentSessionToSessionMeta(session),
      messages: agentSessionToChatMessages(session),
      todos: agentSessionToTodos(session),
      sidePanel: agentSessionToSidePanel(session),
      sendMessage,
      cancelTurn,
      isTurnRunning: session?.follow.running ?? false,
      isMock: false,
      createSession: async () => {
        dispatch({ type: "clear" });
      }
    }),
    [cancelTurn, dispatch, sendMessage, session]
  );
};

export const AgentSelfDevSurface = ({
  desktopApi,
  labels,
  parentSessionId,
  locale
}: AgentSelfDevSurfaceProps) => {
  const [state, dispatch] = useReducer(reducer, { session: null, error: null });
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<AgentSelfDevTarget>("agent-core");
  const [inheritContext, setInheritContext] = useState(true);
  const [starting, setStarting] = useState(false);
  const [selfdevStatus, setSelfdevStatus] = useState<AgentSelfDevStatusResponse | null>(null);

  useEffect(() => {
    if (locale !== undefined) {
      setLocale(locale as Locale);
    }
  }, [locale]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) return;
    let disposed = false;
    void desktopApi.agent.readSelfDevStatus({
      sessionId: state.session?.id ?? null
    })
      .then((response) => {
        if (!disposed) setSelfdevStatus(response);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSelfdevStatus({
            available: false,
            output: toErrorMessage(error)
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [desktopApi, state.session?.id]);

  useEffect(() => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) return;
    const unsubscribe = agentApi.onEvent((event) => {
      dispatch({ type: "event", event });
      if (
        state.session !== null &&
        "sessionId" in event &&
        event.sessionId === state.session.id &&
        (event.kind === "turnFinished" || event.kind === "turnFailed")
      ) {
        void agentApi.readSession({ sessionId: state.session.id })
          .then((snapshot) => dispatch({ type: "snapshot", snapshot }))
          .catch(() => undefined);
      }
    });
    return unsubscribe;
  }, [desktopApi, state.session]);

  const data = useSelfDevChatData(desktopApi, state.session, dispatch);

  const startSelfDev = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || starting) return;
    setStarting(true);
    try {
      const response = await desktopApi.agent.startSelfDev({
        prompt: prompt.trim() || null,
        target,
        inheritContext,
        parentSessionId
      });
      dispatch({ type: "snapshot", snapshot: response.snapshot });
      setSelfdevStatus((current) => ({
        ...(current ?? { available: true, output: "" }),
        available: true,
        repoDir: response.repoDir,
        sessionId: response.sessionId
      }));
      setPrompt("");
    } catch (error: unknown) {
      dispatch({ type: "error", message: toErrorMessage(error) });
    } finally {
      setStarting(false);
    }
  }, [desktopApi, inheritContext, parentSessionId, prompt, starting, target]);

  const repoDir = selfdevStatus?.repoDir ?? state.session?.workingDir ?? "";
  const running = state.session?.follow.running ?? false;
  const unavailable =
    desktopApi?.agent === undefined || selfdevStatus?.available === false;

  return (
    <section className="lyra-agent-selfdev-surface" aria-label={labels.title}>
      <aside className="lyra-agent-selfdev-panel">
        <div className="lyra-agent-selfdev-kicker">{labels.title}</div>
        <p className="lyra-agent-selfdev-subtitle">{labels.subtitle}</p>

        <label className="lyra-agent-selfdev-field">
          <span>{labels.promptLabel}</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={labels.promptPlaceholder}
            rows={7}
          />
        </label>

        <fieldset className="lyra-agent-selfdev-fieldset">
          <legend>{labels.targetLabel}</legend>
          <div className="lyra-agent-selfdev-segments">
            {targetOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={option === target ? "is-active" : ""}
                onClick={() => setTarget(option)}
              >
                {targetLabel(labels, option)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="lyra-agent-selfdev-toggle">
          <input
            type="checkbox"
            checked={inheritContext}
            onChange={(event) => setInheritContext(event.target.checked)}
          />
          <span>{labels.inheritContext}</span>
        </label>

        <button
          type="button"
          className="lyra-agent-selfdev-start"
          disabled={starting || unavailable}
          onClick={() => void startSelfDev()}
        >
          {starting ? labels.starting : labels.start}
        </button>

        {state.error !== null ? (
          <div className="lyra-agent-selfdev-error" role="status">{state.error}</div>
        ) : null}
      </aside>

      <main className="lyra-agent-selfdev-main">
        <header className="lyra-agent-selfdev-status">
          <span className="lyra-agent-selfdev-badge">self-dev</span>
          <span>{labels.status}: {running ? labels.running : labels.idle}</span>
          {repoDir.trim().length > 0 ? <span>{labels.repo}: {repoDir}</span> : null}
          {selfdevStatus?.output.toLowerCase().includes("reload") ? (
            <span>{labels.restartRequired}</span>
          ) : null}
        </header>
        {state.session === null ? (
          <section className="lyra-agent-selfdev-empty">
            <h2>{unavailable ? labels.unavailable : labels.emptyTitle}</h2>
            <p>{selfdevStatus?.available === false ? selfdevStatus.output : labels.emptyDescription}</p>
          </section>
        ) : (
          <div className="lyra-agent-selfdev-chat">
            <AgentChatApp
              data={data}
              showHeader={false}
              {...(locale === undefined ? {} : { locale: locale as Locale })}
            />
          </div>
        )}
      </main>
    </section>
  );
};
