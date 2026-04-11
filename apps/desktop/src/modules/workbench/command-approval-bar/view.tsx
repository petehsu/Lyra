import { useCallback, useMemo, useState } from "react";
import { Terminal, Shield, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import type {
  CommandApprovalRequest,
  CommandApprovalResponse,
  ApprovalDecision,
  RiskLevel,
} from "./types";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import "./styles.css";

interface CommandApprovalBarProps {
  request: CommandApprovalRequest;
  onDecision: (response: CommandApprovalResponse) => void;
  locale?: WorkbenchLocale;
}

const RISK_CONFIG: Record<RiskLevel, { color: string; icon: typeof Shield }> = {
  safe: { color: "#22c55e", icon: ShieldCheck },
  low: { color: "#84cc16", icon: ShieldCheck },
  medium: { color: "#eab308", icon: Shield },
  high: { color: "#f97316", icon: ShieldAlert },
  critical: { color: "#ef4444", icon: ShieldAlert },
};

const RISK_LEVEL_LABEL_KEYS: Record<RiskLevel, "permission.riskLevel.safe" | "permission.riskLevel.low" | "permission.riskLevel.medium" | "permission.riskLevel.high" | "permission.riskLevel.critical"> = {
  safe: "permission.riskLevel.safe",
  low: "permission.riskLevel.low",
  medium: "permission.riskLevel.medium",
  high: "permission.riskLevel.high",
  critical: "permission.riskLevel.critical"
};

const DECISION_LABEL_KEYS: Record<ApprovalDecision, "permission.decision.allow_once" | "permission.decision.allow_always" | "permission.decision.deny"> = {
  allow_once: "permission.decision.allow_once",
  allow_always: "permission.decision.allow_always",
  deny: "permission.decision.deny"
};

export function CommandApprovalBar({
  request,
  onDecision,
  locale = "en-US"
}: CommandApprovalBarProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const handleDecision = useCallback(
    (decision: ApprovalDecision) => {
      onDecision({
        requestId: request.id,
        decision,
        timestamp: Date.now(),
      });
    },
    [request.id, onDecision],
  );

  const risk = RISK_CONFIG[request.riskLevel];
  const RiskIcon = risk.icon;
  const ToolIcon = request.toolName.startsWith("terminal.") ? Terminal : Wrench;

  return (
    <div className="lyra-command-approval-bar">
      <div className="lyra-command-approval-bar__inner">
        {/* Left: tool icon + command preview */}
        <div className="lyra-command-approval-bar__left">
          <ToolIcon className="lyra-command-approval-bar__tool-icon" size={16} />
          <span className="lyra-command-approval-bar__command">
            <code>{request.command}</code>
          </span>
          {request.isRepeat && (
            <span className="lyra-command-approval-bar__repeat-badge">
              {t("permission.repeatCommand")}
            </span>
          )}
        </div>

        {/* Center: risk indicator */}
        <div className="lyra-command-approval-bar__center">
          <RiskIcon
            className="lyra-command-approval-bar__risk-icon"
            size={14}
            style={{ color: risk.color }}
          />
          <span
            className="lyra-command-approval-bar__risk-label"
            style={{ color: risk.color }}
          >
            {t(RISK_LEVEL_LABEL_KEYS[request.riskLevel])}
          </span>
          <button
            className="lyra-command-approval-bar__details-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("permission.hideDetails") : t("permission.showDetails")}
          </button>
        </div>

        {/* Right: action buttons */}
        <div className="lyra-command-approval-bar__actions">
          <button
            className="lyra-command-approval-bar__btn lyra-command-approval-bar__btn--allow"
            onClick={() => handleDecision("allow_always")}
            title={t("permission.allowAlways")}
          >
            {t("permission.allowAlways")}
          </button>
          <button
            className="lyra-command-approval-bar__btn lyra-command-approval-bar__btn--allow-once"
            onClick={() => handleDecision("allow_once")}
            title={t("permission.allowOnce")}
          >
            {t("permission.allowOnce")}
          </button>
          <button
            className="lyra-command-approval-bar__btn lyra-command-approval-bar__btn--deny"
            onClick={() => handleDecision("deny")}
            title={t("permission.deny")}
          >
            {t("permission.deny")}
          </button>
        </div>
      </div>

      {/* Expanded details panel */}
      {expanded && (
        <div className="lyra-command-approval-bar__details">
          <div className="lyra-command-approval-bar__detail-row">
            <span className="lyra-command-approval-bar__detail-label">
              {t("permission.tool")}:
            </span>
            <span>{request.toolLabel}</span>
          </div>
          <div className="lyra-command-approval-bar__detail-row">
            <span className="lyra-command-approval-bar__detail-label">
              {t("permission.command")}:
            </span>
            <code>{request.command}</code>
          </div>
          {request.cwd && (
            <div className="lyra-command-approval-bar__detail-row">
              <span className="lyra-command-approval-bar__detail-label">
                {t("permission.workingDir")}:
              </span>
              <code>{request.cwd}</code>
            </div>
          )}
          <div className="lyra-command-approval-bar__detail-row">
            <span className="lyra-command-approval-bar__detail-label">
              {t("permission.riskAssessment")}:
            </span>
            <span>{request.riskDescription}</span>
          </div>
          {request.mode && (
            <div className="lyra-command-approval-bar__detail-row">
              <span className="lyra-command-approval-bar__detail-label">
                {t("permission.mode")}:
              </span>
              <span>{request.mode}</span>
            </div>
          )}
          {request.interactiveCategory && (
            <div className="lyra-command-approval-bar__detail-row">
              <span className="lyra-command-approval-bar__detail-label">
                {t("permission.interactiveCategory")}:
              </span>
              <span>{request.interactiveCategory}</span>
            </div>
          )}
          {request.previousDecision && (
            <div className="lyra-command-approval-bar__detail-row">
              <span className="lyra-command-approval-bar__detail-label">
                {t("permission.previousDecision")}:
              </span>
              <span>
                {t(DECISION_LABEL_KEYS[request.previousDecision])}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
