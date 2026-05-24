import { ipcMain, type BrowserWindow } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  AgentDecisionSubmitRequest,
  AgentGitDiffRequest,
  AgentGitDiffResponse,
  AgentGitFileRequest,
  AgentGitMutationResponse,
  AgentGitStatusRequest,
  AgentGitStatusSnapshot,
  AgentPermissionRespondRequest,
  AgentRollbackPreviewResponse,
  AgentRollbackRequest,
  AgentRollbackRestoreResponse,
  AgentRuntimeEvent,
  AgentSelfDevStartRequest,
  AgentSelfDevStartResponse,
  AgentSelfDevStatusRequest,
  AgentSelfDevStatusResponse,
  AgentSessionArchiveRequest,
  AgentSessionBindProjectRequest,
  AgentSessionCreateRequest,
  AgentSessionDeleteRequest,
  AgentSessionDeleteResponse,
  AgentSessionReadRequest,
  AgentSessionRenameRequest,
  AgentSessionSaveRequest,
  AgentSessionSnapshot,
  AgentTurnCancelRequest,
  AgentTurnCancelResponse,
  AgentTurnSendRequest,
  AgentTurnSendResponse,
  JcodeAgentActionRunRequest,
  JcodeAccountLoginRequest,
  JcodeAccountRequest,
  JcodeAccountsResponse,
  JcodeAutomationUpdateRequest,
  JcodeAutomationUpdateResponse,
  JcodeBtwRunRequest,
  JcodeCompactResponse,
  JcodeFeedbackRunRequest,
  JcodeCommandsListResponse,
  JcodeConfigSnapshot,
  JcodeConfigUpdateRequest,
  JcodeAgentRolesUpdateRequest,
  JcodeGoalsRequest,
  JcodeGoalsResponse,
  JcodeModelRefreshRequest,
  JcodeModelsListRequest,
  JcodeModelsListResponse,
  JcodeModelSwitchRequest,
  JcodeOvernightListResponse,
  JcodeOvernightRunRequest,
  JcodeOvernightRunResponse,
  JcodeOvernightStartRequest,
  JcodeOvernightStartResponse,
  JcodeProviderOptionsUpdateRequest,
  JcodeProviderProfileSaveRequest,
  JcodePokeRequest,
  JcodePokeResponse,
  JcodeSessionActionRequest,
  JcodeSessionForkResponse,
  JcodeSessionSummary,
  JcodeSessionsListRequest,
  JcodeSessionsListResponse,
  JcodeSidePanelActionResponse,
  JcodeSubagentRunRequest,
  JcodeSubagentRunResponse
} from "../../shared/agent";
import fs from "node:fs";
import path from "node:path";
import type { LyraRuntimeClient } from "../runtime-client";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";

export type AgentIpcBridge = {
  readonly dispose: () => void;
};

const AGENT_RUNTIME_EVENT_NAME = "agent.runtime";

export const createAgentIpcBridge = ({
  runtimeClient,
  getWindow,
  getBrowserBridge
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
}): AgentIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, payload);

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, payload as AgentRuntimeEvent);
  });

  const browserHandlers: Record<string, (payload: any) => Promise<any> | any> = {
    "browser.listTabs": async () => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const activeTabId = browser.readActiveTabId();
      return {
        tabs: activeTabId ? [{ id: activeTabId, active: true, title: "Active Page" }] : []
      };
    },
    "browser.newSession": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const url = payload.url || "about:blank";
      const res = await browser.navigate({ url });
      return {
        tabId: res.tabId || "active-tab",
        url: res.url
      };
    },
    "browser.setActiveTab": async () => {
      return { ok: true };
    },
    "browser.getActiveTab": async () => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const activeTabId = browser.readActiveTabId();
      const state = browser.readPageState();
      return {
        tabId: activeTabId || "active-tab",
        url: state?.url || ""
      };
    },
    "browser.listFrames": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";
      const frames = browser.listFrames(tabId);
      return { frames };
    },
    "browser.navigate": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const url = payload.url;
      const res = await browser.navigate({ url });
      return res;
    },
    "browser.getContent": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";
      const format = payload.format || "text";
      if (format === "annotated") {
        const dom = await browser.readPageDomSummary(tabId);
        return { content: JSON.stringify(dom) };
      } else {
        const textRes = await browser.extractPageText(tabId);
        return { content: textRes.text };
      }
    },
    "browser.getInteractables": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";
      const dom = await browser.readPageDomSummary(tabId);
      return { elements: dom.elements || [] };
    },
    "browser.click": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";

      if (payload.x !== undefined && payload.y !== undefined) {
        await browser.dispatchNativeInput(tabId, [
          { type: "mouseDown", x: payload.x, y: payload.y, button: "left", clickCount: 1 },
          { type: "mouseUp", x: payload.x, y: payload.y, button: "left", clickCount: 1 }
        ]);
        return { clicked: true };
      }

      if (payload.selector) {
        await browser.executeFrameScript(tabId, {
          script: `document.querySelector(${JSON.stringify(payload.selector)}).click()`,
          frameTreeNodeId: payload.frameId
        });
        return { clicked: true };
      }

      throw new Error("Click requires coordinates or selector");
    },
    "browser.type": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";

      if (payload.selector) {
        await browser.executeFrameScript(tabId, {
          script: `(() => {
            const el = document.querySelector(${JSON.stringify(payload.selector)});
            el.focus();
            if (${payload.clear === true}) el.value = '';
            el.value += ${JSON.stringify(payload.text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (${payload.submit === true}) {
              if (el.form) el.form.submit();
            }
          })()`,
          frameTreeNodeId: payload.frameId
        });
        return { typed: true };
      }
      throw new Error("Type requires a selector");
    },
    "browser.fillForm": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";

      const fields = payload.fields || [];
      for (const field of fields) {
        await browser.executeFrameScript(tabId, {
          script: `(() => {
            const el = document.querySelector(${JSON.stringify(field.selector)});
            if (!el) return;
            el.focus();
            if (${field.checked !== undefined}) {
              el.checked = ${field.checked};
            } else if (${field.value !== undefined}) {
              el.value = ${JSON.stringify(field.value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()`,
          frameTreeNodeId: payload.frameId
        });
      }
      return { filled: true };
    },
    "browser.waitFor": async (payload) => {
      const timeout = payload.timeout || 1000;
      await new Promise(r => setTimeout(r, timeout));
      return { waited: true };
    },
    "browser.screenshot": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";
      const res = await browser.capturePage(tabId);

      if (payload.filename && res.data) {
        const bytes = Buffer.from(res.data, "base64");
        await fs.promises.mkdir(path.dirname(payload.filename), { recursive: true });
        await fs.promises.writeFile(payload.filename, bytes);
        return { saved: payload.filename };
      }
      return { data: res.data };
    },
    "browser.evaluate": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";
      const res = await browser.executeFrameScript(tabId, {
        script: payload.script,
        frameTreeNodeId: payload.frameId
      });
      return { result: res };
    },
    "browser.scroll": async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = payload.tabId || browser.readActiveTabId() || "";

      let x = payload.x || 0;
      let y = payload.y || 0;
      if (payload.scrollTo) {
        x = payload.scrollTo.x || 0;
        y = payload.scrollTo.y || 0;
      }

      await browser.executeFrameScript(tabId, {
        script: `window.scrollTo(${x}, ${y})`,
        frameTreeNodeId: payload.frameId
      });
      return { scrolled: true };
    }
  };

  for (const [method, handler] of Object.entries(browserHandlers)) {
    runtimeClient.registerRequestHandler(method, handler);
  }

  const handlers: Array<readonly [string, (_event: Electron.IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.agentSessionCreate,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.create",
          (payload as AgentSessionCreateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRead,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.read",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionList,
      (_event, payload) =>
        requestRuntime<JcodeSessionsListResponse>(
          "agent.session.list",
          (payload as JcodeSessionsListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionSave,
      (_event, payload) =>
        requestRuntime<JcodeSessionSummary>(
          "agent.session.save",
          payload as AgentSessionSaveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionUnsave,
      (_event, payload) =>
        requestRuntime<JcodeSessionSummary>(
          "agent.session.unsave",
          payload as AgentSessionDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRename,
      (_event, payload) =>
        requestRuntime<JcodeSessionSummary>(
          "agent.session.rename",
          payload as AgentSessionRenameRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionArchive,
      (_event, payload) =>
        requestRuntime<JcodeSessionSummary>(
          "agent.session.archive",
          payload as AgentSessionArchiveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionDelete,
      (_event, payload) =>
        requestRuntime<AgentSessionDeleteResponse>(
          "agent.session.delete",
          payload as AgentSessionDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionBindProject,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.bindProject",
          payload as AgentSessionBindProjectRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevStart,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStartResponse>(
          "agent.selfdev.start",
          (payload as AgentSelfDevStartRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevStatus,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStatusResponse>(
          "agent.selfdev.status",
          (payload as AgentSelfDevStatusRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevSendTurn,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.selfdev.sendTurn",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnSend,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.send",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnCancel,
      (_event, payload) =>
        requestRuntime<AgentTurnCancelResponse>(
          "agent.turn.cancel",
          payload as AgentTurnCancelRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackPreview,
      (_event, payload) =>
        requestRuntime<AgentRollbackPreviewResponse>(
          "agent.rollback.preview",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackRestore,
      (_event, payload) =>
        requestRuntime<AgentRollbackRestoreResponse>(
          "agent.rollback.restore",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStatus,
      (_event, payload) =>
        requestRuntime<AgentGitStatusSnapshot>(
          "agent.git.status",
          payload as AgentGitStatusRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiff,
      (_event, payload) =>
        requestRuntime<AgentGitDiffResponse>(
          "agent.git.diff",
          payload as AgentGitDiffRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.stage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitUnstage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.unstage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiscard,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.discard",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentDecisionSubmit,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.decision.submit",
          payload as AgentDecisionSubmitRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPermissionRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.permission.respond",
          payload as AgentPermissionRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeConfigRead,
      () => requestRuntime<JcodeConfigSnapshot>("jcode.config.read")
    ],
    [
      LYRA_CHANNELS.jcodeConfigUpdate,
      (_event, payload) =>
        requestRuntime<JcodeConfigSnapshot>(
          "jcode.config.update",
          (payload as JcodeConfigUpdateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeProviderProfileSave,
      (_event, payload) =>
        requestRuntime<JcodeConfigSnapshot>(
          "jcode.provider.profile.save",
          payload as JcodeProviderProfileSaveRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeCommandsList,
      () => requestRuntime<JcodeCommandsListResponse>("jcode.commands.list")
    ],
    [
      LYRA_CHANNELS.jcodeSessionsList,
      (_event, payload) =>
        requestRuntime<JcodeSessionsListResponse>(
          "jcode.sessions.list",
          (payload as JcodeSessionsListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeModelsList,
      (_event, payload) =>
        requestRuntime<JcodeModelsListResponse>(
          "jcode.models.list",
          (payload as JcodeModelsListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeModelSwitch,
      (_event, payload) =>
        requestRuntime<JcodeModelsListResponse>(
          "jcode.model.switch",
          payload as JcodeModelSwitchRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeModelRefresh,
      (_event, payload) =>
        requestRuntime<JcodeModelsListResponse>(
          "jcode.model.refresh",
          (payload as JcodeModelRefreshRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeProviderOptionsUpdate,
      (_event, payload) =>
        requestRuntime<JcodeModelsListResponse>(
          "jcode.provider.options.update",
          payload as JcodeProviderOptionsUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeAgentRolesUpdate,
      (_event, payload) =>
        requestRuntime<JcodeConfigSnapshot>(
          "jcode.agent-roles.update",
          payload as JcodeAgentRolesUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeImproveRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "jcode.improve.run",
          (payload as JcodeAgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeRefactorRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "jcode.refactor.run",
          (payload as JcodeAgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodePokeTrigger,
      (_event, payload) =>
        requestRuntime<JcodePokeResponse>(
          "jcode.poke.trigger",
          (payload as JcodePokeRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeReviewRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "jcode.review.run",
          (payload as JcodeFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeJudgeRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "jcode.judge.run",
          (payload as JcodeFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeSubagentRun,
      (_event, payload) =>
        requestRuntime<JcodeSubagentRunResponse>(
          "jcode.subagent.run",
          payload as JcodeSubagentRunRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeBtwRun,
      (_event, payload) =>
        requestRuntime<JcodeSidePanelActionResponse>(
          "jcode.btw.run",
          payload as JcodeBtwRunRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeSessionSplit,
      (_event, payload) =>
        requestRuntime<JcodeSessionForkResponse>(
          "jcode.session.split",
          (payload as JcodeSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeSessionTransfer,
      (_event, payload) =>
        requestRuntime<JcodeSessionForkResponse>(
          "jcode.session.transfer",
          (payload as JcodeSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeSessionCompact,
      (_event, payload) =>
        requestRuntime<JcodeCompactResponse>(
          "jcode.session.compact",
          (payload as JcodeSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeSessionAutomationUpdate,
      (_event, payload) =>
        requestRuntime<JcodeAutomationUpdateResponse>(
          "jcode.session.automation.update",
          payload as JcodeAutomationUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeGoalsList,
      (_event, payload) =>
        requestRuntime<JcodeGoalsResponse>(
          "jcode.goals.list",
          (payload as JcodeGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeGoalsOpen,
      (_event, payload) =>
        requestRuntime<JcodeGoalsResponse>(
          "jcode.goals.open",
          (payload as JcodeGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeGoalsResume,
      (_event, payload) =>
        requestRuntime<JcodeGoalsResponse>(
          "jcode.goals.resume",
          (payload as JcodeGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeGoalsShow,
      (_event, payload) =>
        requestRuntime<JcodeGoalsResponse>(
          "jcode.goals.show",
          payload as JcodeGoalsRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeAccountsList,
      () => requestRuntime<JcodeAccountsResponse>("jcode.accounts.list")
    ],
    [
      LYRA_CHANNELS.jcodeAccountsLogin,
      (_event, payload) =>
        requestRuntime<JcodeAccountsResponse>(
          "jcode.accounts.login",
          payload as JcodeAccountLoginRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeAccountsSwitch,
      (_event, payload) =>
        requestRuntime<JcodeAccountsResponse>(
          "jcode.accounts.switch",
          payload as JcodeAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeAccountsRemove,
      (_event, payload) =>
        requestRuntime<JcodeAccountsResponse>(
          "jcode.accounts.remove",
          payload as JcodeAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeOvernightStart,
      (_event, payload) =>
        requestRuntime<JcodeOvernightStartResponse>(
          "jcode.overnight.start",
          payload as JcodeOvernightStartRequest
        )
    ],
    [
      LYRA_CHANNELS.jcodeOvernightList,
      () => requestRuntime<JcodeOvernightListResponse>("jcode.overnight.list")
    ],
    [
      LYRA_CHANNELS.jcodeOvernightStatus,
      (_event, payload) =>
        requestRuntime<JcodeOvernightRunResponse>(
          "jcode.overnight.status",
          (payload as JcodeOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeOvernightLog,
      (_event, payload) =>
        requestRuntime<JcodeOvernightRunResponse>(
          "jcode.overnight.log",
          (payload as JcodeOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeOvernightReview,
      (_event, payload) =>
        requestRuntime<JcodeOvernightRunResponse>(
          "jcode.overnight.review",
          (payload as JcodeOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.jcodeOvernightCancel,
      (_event, payload) =>
        requestRuntime<JcodeOvernightRunResponse>(
          "jcode.overnight.cancel",
          (payload as JcodeOvernightRunRequest | undefined) ?? {}
        )
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      for (const method of Object.keys(browserHandlers)) {
        runtimeClient.unregisterRequestHandler(method);
      }
    }
  };
};
