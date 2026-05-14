import { Terminal, FileText, Globe, AlertTriangle } from "lucide-react";
import { ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { t } from "../../core/i18n";

export interface PermissionRequest {
  id: string;
  type: "shell" | "file" | "network" | "dangerous";
  title: string;
  detail: string;
}

/**
 * Permission approval panel — same layout as DecisionPanel:
 * Header row: icon + "执行 xxx" + command inline + nav
 * Body: approve/deny buttons
 */
export function PermissionPanel({
  requests,
  onApprove,
  onDeny,
  progress,
  onTap,
}: {
  requests: PermissionRequest[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  progress: number;
  onTap: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (requests.length === 0) return null;

  const req = requests[currentIndex] ?? requests[0];
  if (req === undefined) return null;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < requests.length - 1;
  const showNav = requests.length > 1;
  const isCollapsed = progress < 0.1;

  const handleAction = (action: "approve" | "deny") => {
    const id = req.id;
    if (action === "approve") {
      onApprove(id);
    } else {
      onDeny(id);
    }
    // After removing current, adjust index if needed
    if (currentIndex >= requests.length - 1 && currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  };

  return (
    <div
      className="decision-panel permission-panel"
      onClick={isCollapsed ? onTap : undefined}
      style={{ cursor: isCollapsed ? "pointer" : undefined }}
    >
      {/* Header: icon + title + command inline */}
      <div className="decision-header">
        <span className={`decision-icon permission-icon-${req.type}`}>
          {renderPermissionIcon(req.type)}
        </span>
        <p className="decision-question">
          {req.title} <code className="permission-cmd">{req.detail}</code>
        </p>
        {showNav && (
          <div className="decision-nav">
            <button
              type="button"
              className="decision-nav-btn"
              disabled={!canPrev}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i - 1); }}
              aria-label="Previous"
            >
              <ChevronLeft size={14} strokeWidth={2.2} />
            </button>
            <span className="decision-counter">
              {currentIndex + 1}/{requests.length}
            </span>
            <button
              type="button"
              className="decision-nav-btn"
              disabled={!canNext}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i + 1); }}
              aria-label="Next"
            >
              <ChevronRight size={14} strokeWidth={2.2} />
            </button>
          </div>
        )}
      </div>

      {/* Body: approve/deny buttons */}
      <div
        className="decision-body"
        style={{
          maxHeight: `${progress * 200}px`,
          opacity: progress,
          pointerEvents: progress < 0.3 ? "none" : "auto",
          "--panel-progress": progress,
        } as CSSProperties}
      >
        <div className="decision-body-content">
          <div className="permission-actions">
            <button
              type="button"
              className="permission-btn permission-btn-deny"
              onClick={() => handleAction("deny")}
              aria-label={t("permission.deny")}
            >
              <X size={14} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className="permission-btn permission-btn-approve"
              onClick={() => handleAction("approve")}
              aria-label={t("permission.approve")}
            >
              <Check size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderPermissionIcon(type: PermissionRequest["type"]) {
  const props = { size: 14, strokeWidth: 2 };
  switch (type) {
    case "shell":
      return <Terminal {...props} />;
    case "file":
      return <FileText {...props} />;
    case "network":
      return <Globe {...props} />;
    case "dangerous":
      return <AlertTriangle {...props} />;
  }
}
