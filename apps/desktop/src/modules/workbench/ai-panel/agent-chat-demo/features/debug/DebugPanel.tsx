import { useState } from "react";
import { Bug } from "lucide-react";
import { t } from "../../core/i18n";

/**
 * Floating debug panel (top-right corner) to toggle demo-only panels.
 * Exists only to make the demo-mode discoverable; remove when shipping.
 */
export function DebugPanel({
  onToggleDecisions,
  onTogglePermission,
  decisionsVisible,
  permissionVisible,
}: {
  onToggleDecisions: () => void;
  onTogglePermission: () => void;
  decisionsVisible: boolean;
  permissionVisible: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="debug-panel">
      <button
        type="button"
        className="debug-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("debug.title")}
      >
        <Bug size={14} strokeWidth={2} />
      </button>

      {open && (
        <div className="debug-body">
          <div className="debug-title">{t("debug.title")}</div>
          <label className="debug-row">
            <input
              type="checkbox"
              checked={decisionsVisible}
              onChange={onToggleDecisions}
            />
            <span>{t("debug.decisions")}</span>
          </label>
          <label className="debug-row">
            <input
              type="checkbox"
              checked={permissionVisible}
              onChange={onTogglePermission}
            />
            <span>{t("debug.permission")}</span>
          </label>
        </div>
      )}
    </div>
  );
}
