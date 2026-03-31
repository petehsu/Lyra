import {
  Bot,
  Boxes,
  Command,
  FileCode2,
  Maximize2,
  Minimize2,
  Play,
  Square,
  Terminal,
  Webhook
} from "lucide-react";

import type { IntentBarProps } from "./types";

const toggleClass = (active: boolean): string => (active ? "lyra-toggle lyra-toggle-active" : "lyra-toggle");

export const IntentBar = ({
  appVersion,
  intentValue,
  placeholder,
  activePreset,
  showFiles,
  showAi,
  showRuntime,
  onIntentValueChange,
  onRunIntent,
  onPresetChange,
  onTogglePanel,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow
}: IntentBarProps) => (
  <header className="lyra-intent-bar">
    <div className="lyra-brand">
      <span className="lyra-brand-dot" />
      <span className="lyra-brand-text">Lyra</span>
      <span className="lyra-version">v{appVersion}</span>

      <div className="lyra-toggle-group" role="group" aria-label="preset-toggle">
        <button
          className={activePreset === "browser" ? "lyra-toggle lyra-toggle-active" : "lyra-toggle"}
          onClick={() => {
            onPresetChange("browser");
          }}
        >
          Browser
        </button>
        <button
          className={activePreset === "ide" ? "lyra-toggle lyra-toggle-active" : "lyra-toggle"}
          onClick={() => {
            onPresetChange("ide");
          }}
        >
          IDE
        </button>
      </div>
    </div>

    <div className="lyra-intent-input-wrap">
      <Command size={12} />
      <input
        aria-label="intent-input"
        className="lyra-intent-input"
        value={intentValue}
        placeholder={placeholder}
        onChange={(event) => {
          onIntentValueChange(event.target.value);
        }}
      />
      <button className="lyra-primary-button" onClick={onRunIntent}>
        <Play size={12} />
        Go
      </button>
    </div>

    <div className="lyra-intent-controls">
      <button className={toggleClass(showFiles)} title="Files" onClick={() => onTogglePanel("files")}>
        <FileCode2 size={13} />
      </button>
      <button className={toggleClass(showAi)} title="AI Tower" onClick={() => onTogglePanel("ai")}>
        <Bot size={13} />
      </button>
      <button className={toggleClass(showRuntime)} title="Runtime Rail" onClick={() => onTogglePanel("runtime")}>
        <Terminal size={13} />
      </button>
      <button className="lyra-toggle" title="Plugin Shelf">
        <Boxes size={13} />
      </button>
      <button className="lyra-toggle" title="Dispatch Intent">
        <Webhook size={13} />
      </button>

      <div className="lyra-window-buttons">
        <button className="lyra-window-button" onClick={onMinimizeWindow}>
          <Minimize2 size={12} />
        </button>
        <button className="lyra-window-button" onClick={onToggleMaximizeWindow}>
          <Maximize2 size={12} />
        </button>
        <button className="lyra-window-button lyra-window-button-close" onClick={onCloseWindow}>
          <Square size={10} />
        </button>
      </div>
    </div>
  </header>
);
