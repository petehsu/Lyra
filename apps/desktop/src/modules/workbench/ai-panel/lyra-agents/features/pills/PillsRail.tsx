// ============================================================================
// PillsRail — hosts the Diff pill below the header
// ============================================================================

import { DiffStats } from "./DiffStats";
import { useData } from "../../data/DataProvider";

export function PillsRail() {
  const { diffFiles } = useData();
  const hasDiff = diffFiles.length > 0;
  if (!hasDiff) return null;

  return (
    <div className="lyra-agents-pills-rail">
      <DiffStats files={diffFiles} />
    </div>
  );
}
