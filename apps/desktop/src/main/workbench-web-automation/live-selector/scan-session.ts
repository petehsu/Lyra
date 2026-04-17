import { randomUUID } from "node:crypto";

import type { LiveSelectorScanCandidateRecord, LiveSelectorScanSession } from "./types";

const TTL_MS = 120_000;

export class LiveSelectorScanRegistry {
  private readonly sessions = new Map<string, LiveSelectorScanSession>();

  write(input: Omit<LiveSelectorScanSession, "scanSessionId" | "createdAt" | "updatedAt">): LiveSelectorScanSession {
    const now = Date.now();
    const session: LiveSelectorScanSession = {
      scanSessionId: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input
    };
    this.sessions.set(session.scanSessionId, session);
    this.compact();
    return session;
  }

  read(scanSessionId: string): LiveSelectorScanSession | null {
    this.compact();
    const session = this.sessions.get(scanSessionId) ?? null;
    if (session === null) {
      return null;
    }
    const updated = {
      ...session,
      updatedAt: Date.now()
    };
    this.sessions.set(scanSessionId, updated);
    return updated;
  }

  readCandidate(scanSessionId: string, candidateId: string): LiveSelectorScanCandidateRecord | null {
    const session = this.read(scanSessionId);
    if (session === null) {
      return null;
    }
    return session.candidates.find((candidate) => candidate.candidateId === candidateId) ?? null;
  }

  readRecentCandidate(
    candidateId: string,
    options?: {
      readonly tabId?: string;
      readonly preferredScanSessionId?: string;
    }
  ): {
    readonly scanSessionId: string;
    readonly candidate: LiveSelectorScanCandidateRecord;
  } | null {
    this.compact();

    const preferredScanSessionId = options?.preferredScanSessionId?.trim();
    if (preferredScanSessionId) {
      const preferredCandidate = this.readCandidate(preferredScanSessionId, candidateId);
      if (preferredCandidate !== null) {
        return {
          scanSessionId: preferredScanSessionId,
          candidate: preferredCandidate
        };
      }
    }

    const sessions = Array.from(this.sessions.values())
      .filter((session) => options?.tabId === undefined || session.tabId === options.tabId)
      .sort((left, right) => right.updatedAt - left.updatedAt);

    for (const session of sessions) {
      const candidate = session.candidates.find((entry) => entry.candidateId === candidateId);
      if (candidate === undefined) {
        continue;
      }
      this.sessions.set(session.scanSessionId, {
        ...session,
        updatedAt: Date.now()
      });
      return {
        scanSessionId: session.scanSessionId,
        candidate
      };
    }

    return null;
  }

  findRecentCandidate(
    options: {
      readonly tabId?: string;
      readonly preferredScanSessionId?: string;
      readonly match: (
        candidate: LiveSelectorScanCandidateRecord,
        session: LiveSelectorScanSession
      ) => number;
    }
  ): {
    readonly scanSessionId: string;
    readonly candidate: LiveSelectorScanCandidateRecord;
  } | null {
    this.compact();

    let best:
      | {
          readonly scanSessionId: string;
          readonly candidate: LiveSelectorScanCandidateRecord;
          readonly score: number;
        }
      | null = null;

    const considerSession = (session: LiveSelectorScanSession) => {
      for (const candidate of session.candidates) {
        const score = options.match(candidate, session);
        if (!Number.isFinite(score) || score <= 0) {
          continue;
        }
        if (best === null || score > best.score) {
          best = {
            scanSessionId: session.scanSessionId,
            candidate,
            score
          };
        }
      }
    };

    const preferredScanSessionId = options.preferredScanSessionId?.trim();
    if (preferredScanSessionId) {
      const preferredSession = this.read(preferredScanSessionId);
      if (preferredSession !== null && (options.tabId === undefined || preferredSession.tabId === options.tabId)) {
        considerSession(preferredSession);
      }
    }

    const sessions = Array.from(this.sessions.values())
      .filter((session) =>
        (options.tabId === undefined || session.tabId === options.tabId)
        && session.scanSessionId !== preferredScanSessionId
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);

    for (const session of sessions) {
      considerSession(session);
    }

    const resolved = best as {
      readonly scanSessionId: string;
      readonly candidate: LiveSelectorScanCandidateRecord;
      readonly score: number;
    } | null;
    if (resolved === null) {
      return null;
    }

    const session = this.sessions.get(resolved.scanSessionId);
    if (session !== undefined) {
      this.sessions.set(resolved.scanSessionId, {
        ...session,
        updatedAt: Date.now()
      });
    }

    return {
      scanSessionId: resolved.scanSessionId,
      candidate: resolved.candidate
    };
  }

  clearForTab(tabId: string): void {
    for (const [scanSessionId, session] of this.sessions.entries()) {
      if (session.tabId === tabId) {
        this.sessions.delete(scanSessionId);
      }
    }
  }

  private compact(): void {
    const now = Date.now();
    for (const [scanSessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > TTL_MS) {
        this.sessions.delete(scanSessionId);
      }
    }
  }
}
