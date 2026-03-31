import { Search } from "lucide-react";

export { SidebarComposer } from "./composer";
export type { SidebarComposerHandle } from "./composer";
import type { SidebarProps } from "./types";

export const Sidebar = ({ title, entries }: SidebarProps) => (
  <aside className="lyra-sidebar" aria-label="sidebar">
    <header className="lyra-sidebar-header">
      <span>{title}</span>
      <button className="lyra-sidebar-action">Open Recent Project</button>
    </header>
    <div className="lyra-sidebar-search">
      <Search size={12} />
      <input placeholder="Search buffer symbols..." aria-label="sidebar-search" />
    </div>
    <div className="lyra-sidebar-list">
      {entries.map((entry) => (
        <button key={entry} className="lyra-sidebar-entry">
          {entry}
        </button>
      ))}
    </div>
    <footer className="lyra-sidebar-footer">
      <p>No outlines available</p>
      <p>Toggle Panel With ctrl-B</p>
    </footer>
  </aside>
);
