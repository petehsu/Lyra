import { Plus, X } from "lucide-react";

import { resolveTabSubtitle } from "./service";
import type { TabCanvasProps } from "./types";

export const TabCanvas = ({ tabs, activeTabId, onActivateTab, onCloseTab, onCreatePluginTab }: TabCanvasProps) => (
  <section className="lyra-canvas" aria-label="tab-canvas">
    <div className="lyra-tabs">
      {tabs.map((tab) => (
        <div key={tab.id} className={tab.id === activeTabId ? "lyra-tab lyra-tab-active" : "lyra-tab"}>
          <button
            className="lyra-tab-main"
            onClick={() => {
              onActivateTab(tab.id);
            }}
          >
            <span className="lyra-tab-title">{tab.title}</span>
            <span className="lyra-tab-subtitle">{resolveTabSubtitle(tab)}</span>
          </button>
          <button
            className="lyra-tab-close"
            aria-label={`close-${tab.id}`}
            onClick={() => {
              onCloseTab(tab.id);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}

      <button className="lyra-new-tab" onClick={onCreatePluginTab}>
        <Plus size={14} />
        New Tab
      </button>
    </div>

    <div className="lyra-panes">
      <article className="lyra-pane lyra-pane-editor">
        <header className="lyra-pane-header">
          <strong>Editor</strong>
          <span className="lyra-pane-meta">UTF-8  TypeScript</span>
        </header>
        <div className="lyra-pane-body lyra-editor-empty">
          <div className="lyra-welcome-card">
            <h2>Welcome back to Lyra</h2>
            <p>The workbench shell is ready for browser + IDE orchestration.</p>
            <ul className="lyra-welcome-list">
              <li>New File</li>
              <li>Open Project</li>
              <li>Clone Repository</li>
              <li>Open Command Palette</li>
            </ul>
          </div>
        </div>
      </article>

      <article className="lyra-pane lyra-pane-browser">
        <header className="lyra-pane-header">
          <strong>Browser</strong>
          <span className="lyra-pane-meta">DOM  Console  Network</span>
        </header>
        <div className="lyra-pane-body lyra-browser-body">
          <div className="lyra-browser-url">https://localhost:3000/checkout</div>
          <div className="lyra-browser-placeholder">
            <h4>Web Runtime Placeholder</h4>
            <p>Browser-like plugins mount here with isolated lifecycle control.</p>
          </div>
        </div>
      </article>
    </div>
  </section>
);
