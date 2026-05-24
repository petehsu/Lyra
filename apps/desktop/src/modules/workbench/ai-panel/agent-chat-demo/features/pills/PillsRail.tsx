// ============================================================================
// PillsRail — hosts Todo + Diff pills below the header
// ============================================================================

import { TodoBar } from "./TodoBar";
import { DiffStats } from "./DiffStats";
import { useData } from "../../data/DataProvider";

export function PillsRail() {
  const { todos, diffFiles, pokeTodos, isTurnRunning } = useData();
  const hasTodo = todos.length > 0;
  const hasDiff = diffFiles.length > 0;
  if (!hasTodo && !hasDiff) return null;

  return (
    <div className={`pills-rail ${hasTodo && hasDiff ? "two-pills" : ""}`}>
      {hasTodo && <TodoBar tasks={todos} onPoke={pokeTodos} disabled={isTurnRunning} />}
      {hasDiff && <DiffStats files={diffFiles} />}
    </div>
  );
}
