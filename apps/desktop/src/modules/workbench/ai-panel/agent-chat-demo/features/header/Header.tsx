// ============================================================================
// Header — frosted top bar with session title, total diff, project name
// ============================================================================

import { useData } from "../../data/DataProvider";
import { t } from "../../core/i18n";

export function Header() {
  const { session } = useData();

  return (
    <header className="app-header">
      <div className="app-header-title">{session.title}</div>
      <div className="app-header-right">
        <span className="app-header-diff">
          <span className="diff-add">+{session.totalAdditions}</span>
          <span className="diff-del">-{session.totalDeletions}</span>
        </span>
        <span className="app-header-project">{session.project}</span>
        <span className="app-header-about" title={t("app.title")}>
          ?
        </span>
      </div>
    </header>
  );
}
