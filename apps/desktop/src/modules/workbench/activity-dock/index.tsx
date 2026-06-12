import { FolderTree, Puzzle, Search } from "lucide-react";

import { AppIconButton } from "@renderer/ui/components";
import { activityDockItems } from "./service";
import type { ActivityDockItemId, ActivityDockProps } from "./types";

const iconByItemId: Record<ActivityDockItemId, JSX.Element> = {
  explorer: <FolderTree size={17} aria-hidden="true" />,
  search: <Search size={17} aria-hidden="true" />,
  plugins: <Puzzle size={17} aria-hidden="true" />
};

export const ActivityDock = ({ activeItemId, onSelect }: ActivityDockProps) => (
  <nav className="lyra-activity-dock" aria-label="activity-dock">
    {activityDockItems.map((item) => (
      <AppIconButton
        key={item.id}
        title={item.label}
        aria-label={item.label}
        active={item.id === activeItemId}
        className="lyra-activity-button"
        onClick={() => {
          onSelect(item.id);
        }}
      >
        {iconByItemId[item.id]}
      </AppIconButton>
    ))}
  </nav>
);
