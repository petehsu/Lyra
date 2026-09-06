import type {
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserPageDiagnosticEntry
} from "../../../shared/desktop-bridge";

import { coerceFrameBounds } from "./normalizers";

export const authSignalsFromPageDiagnostics = (
  entries: readonly WorkbenchBrowserPageDiagnosticEntry[]
): WorkbenchBrowserAuthChallengeSignal[] => entries.flatMap(
  (entry): WorkbenchBrowserAuthChallengeSignal[] => {
    if ((entry.status === 401 || entry.status === 403) && entry.resourceType === "Document") {
      return [{
        kind: "login_wall",
        confidence: "low",
        source: "diagnostic",
        label: `http ${entry.status}`,
        scope: "main_document",
        resourceType: entry.resourceType,
        actionability: "informational",
        reasonCode: "http_auth_response",
        stableObservationCount: 1,
        ...(entry.url === undefined ? {} : { url: entry.url })
      }];
    }
    if (entry.resourceType === "Document" && entry.mimeType?.includes("octet-stream")) {
      return [{
        kind: "download_prompt",
        confidence: "medium",
        source: "diagnostic",
        label: "download response",
        ...(entry.url === undefined ? {} : { url: entry.url })
      }];
    }
    return [];
  }
);

export const normalizeAuthChallengeSignals = (
  values: readonly unknown[]
): WorkbenchBrowserAuthChallengeSignal[] => values
  .map((value): WorkbenchBrowserAuthChallengeSignal | null => {
    if (value === null || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const { kind, confidence, source } = record;
    if (
      (
        kind !== "captcha"
        && kind !== "mfa"
        && kind !== "oauth_popup"
        && kind !== "permission_prompt"
        && kind !== "dormant_file_input"
        && kind !== "active_file_chooser"
        && kind !== "login_wall"
        && kind !== "download_prompt"
        && kind !== "payment_auth"
      )
      || (confidence !== "high" && confidence !== "medium" && confidence !== "low")
      || (source !== "dom" && source !== "attribute" && source !== "frame"
        && source !== "browser" && source !== "diagnostic")
    ) return null;
    const bounds = coerceFrameBounds(record.bounds);
    return {
      kind,
      confidence,
      source,
      ...(record.scope === "main_document" || record.scope === "subresource" || record.scope === "frame"
        ? { scope: record.scope }
        : {}),
      ...(typeof record.resourceType === "string" && record.resourceType.length > 0
        ? { resourceType: record.resourceType }
        : {}),
      ...(record.actionability === "informational" || record.actionability === "automatic"
        || record.actionability === "user_only"
        ? { actionability: record.actionability }
        : {}),
      ...(typeof record.reasonCode === "string" && record.reasonCode.length > 0
        ? { reasonCode: record.reasonCode }
        : {}),
      ...(Number.isFinite(Number(record.stableObservationCount))
        ? { stableObservationCount: Math.max(0, Math.round(Number(record.stableObservationCount))) }
        : {}),
      ...(typeof record.label === "string" && record.label.length > 0 ? { label: record.label } : {}),
      ...(typeof record.url === "string" && record.url.length > 0 ? { url: record.url } : {}),
      ...(typeof record.frameRef === "string" && record.frameRef.length > 0
        ? { frameRef: record.frameRef }
        : {}),
      ...(Number.isFinite(Number(record.frameTreeNodeId))
        ? { frameTreeNodeId: Math.round(Number(record.frameTreeNodeId)) }
        : {}),
      ...(bounds === null ? {} : { bounds })
    };
  })
  .filter((value): value is WorkbenchBrowserAuthChallengeSignal => value !== null);
