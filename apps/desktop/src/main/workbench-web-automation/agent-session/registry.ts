import type { WorkbenchAgentWebSession } from "./types";

const TTL_MS = 120_000;

const sessionKeyOf = (agentSessionId: string, agentTurnId: string, tabId: string): string =>
  `${agentSessionId}:${agentTurnId}:${tabId}`;

export class WorkbenchAgentWebSessionRegistry {
  private readonly sessions = new Map<string, WorkbenchAgentWebSession>();

  upsert(input: Omit<WorkbenchAgentWebSession, "sessionKey" | "createdAt" | "updatedAt">): WorkbenchAgentWebSession {
    const sessionKey = sessionKeyOf(input.agentSessionId, input.agentTurnId, input.tabId);
    const existing = this.sessions.get(sessionKey);
    const next: WorkbenchAgentWebSession = {
      sessionKey,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ...input
    };
    this.sessions.set(sessionKey, next);
    this.compact();
    return next;
  }

  read(agentSessionId: string, agentTurnId: string, tabId: string): WorkbenchAgentWebSession | null {
    this.compact();
    return this.sessions.get(sessionKeyOf(agentSessionId, agentTurnId, tabId)) ?? null;
  }

  clear(tabId: string): void {
    for (const [sessionKey, session] of this.sessions.entries()) {
      if (session.tabId === tabId) {
        this.sessions.delete(sessionKey);
      }
    }
  }

  private compact(): void {
    const now = Date.now();
    for (const [sessionKey, session] of this.sessions.entries()) {
      if (now - session.updatedAt > TTL_MS) {
        this.sessions.delete(sessionKey);
      }
    }
  }
}
