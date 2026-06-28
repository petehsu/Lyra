import { useState } from "react";
import { Bug } from "lucide-react";
import { t } from "@workbench/i18n";
import { AppButton, AppCheckbox } from "@renderer/ui/components";

/**
 * Floating debug panel (top-right corner) for local panel diagnostics.
 * Hidden in normal product flows.
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
    <div className="lyra-agents-debug-panel">
      <AppButton variant="ghost" size="sm"
        type="button"
        className="lyra-agents-debug-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("debug.title")}
      >
        <Bug size={14} strokeWidth={2} />
      </AppButton>

      {open && (
        <div className="lyra-agents-debug-body">
          <div className="lyra-agents-debug-title">{t("debug.title")}</div>
          <label className="lyra-agents-debug-row">
            <AppCheckbox
              checked={decisionsVisible}
              onCheckedChange={onToggleDecisions}
            />
            <span>{t("debug.decisions")}</span>
          </label>
          <label className="lyra-agents-debug-row">
            <AppCheckbox
              checked={permissionVisible}
              onCheckedChange={onTogglePermission}
            />
            <span>{t("debug.permission")}</span>
          </label>
        </div>
      )}
    </div>
  );
}
