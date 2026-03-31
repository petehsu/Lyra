import { FolderTree, Puzzle, Search, Settings2 } from "lucide-react";

import { activityDockItems } from "./service";
import type { ActivityDockItemId, ActivityDockProps } from "./types";

const iconByItemId: Record<ActivityDockItemId, JSX.Element> = {
  explorer: <FolderTree size={17} />,
  search: <Search size={17} />,
  plugins: <Puzzle size={17} />,
  settings: <Settings2 size={17} />
};

export const ActivityDock = ({ activeItemId, onSelect }: ActivityDockProps) => (
  <nav className="lyra-activity-dock" aria-label="activity-dock">
    {activityDockItems.map((item) => (
      <button
        key={item.id}
        title={item.label}
        className={item.id === activeItemId ? "lyra-activity-button lyra-activity-button-active" : "lyra-activity-button"}
        onClick={() => {
          onSelect(item.id);
        }}
      >
        {iconByItemId[item.id]}
      </button>
    ))}
  </nav>
);
