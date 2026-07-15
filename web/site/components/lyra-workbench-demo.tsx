"use client";

import {
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FileText,
  Folder,
  History,
  House,
  KeyRound,
  Layers3,
  Monitor,
  Moon,
  MoreHorizontal,
  Package,
  Palette,
  PanelBottom,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Store,
  Sun,
  Terminal,
  Webhook,
  X
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import { LYRA_ASCII_LOGO } from "@/lib/ascii-logo";
import type { SiteTheme } from "@/lib/site-preferences";

type WorkspaceId = "site" | "home" | "settings" | "docs";
type SettingsId = "general" | "appearance" | "workspace";

export const LYRA_DEMO_LAYOUT_EVENT = "lyra:demo-layout-change";

type LyraWorkbenchDemoProps = {
  readonly copy: SiteCopy["demo"];
  readonly className?: string;
  readonly siteSurface?: ReactNode;
  readonly initialWorkspace?: WorkspaceId;
  readonly initialTerminalVisible?: boolean;
  readonly locale: SiteLocale;
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
};

const settingsIcons = {
  general: SlidersHorizontal,
  appearance: Palette,
  workspace: Monitor,
  notifications: Bell,
  login: KeyRound,
  lyra: Sparkles,
  search: Search,
  agents: Bot,
  models: Package,
  skills: Sparkles,
  mcp: Webhook,
  experimental: Box
} as const;

const IconButton = ({
  label,
  active = false,
  onClick,
  children
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly children: React.ReactNode;
}) => (
  <button
    className="lyra-demo-icon-button"
    type="button"
    aria-label={label}
    title={label}
    data-active={active}
    onClick={onClick}
  >
    {children}
  </button>
);

function AiPanel({
  copy
}: {
  readonly copy: SiteCopy["demo"];
}) {
  const [activeTab, setActiveTab] = useState<"hello" | "new">("new");
  const [message, setMessage] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = message.trim();
    if (value.length === 0) return;
    setSentMessage(value);
    setMessage("");
  };

  return (
    <aside className="lyra-demo-ai-panel">
      <div className="lyra-demo-session-tabs">
        <button
          type="button"
          className="lyra-demo-session-tab"
          data-active={activeTab === "hello"}
          onClick={() => setActiveTab("hello")}
        >
          <img src="/lyra-mark.svg" alt="" />
          <span>{copy.tabs.hello}</span>
          <X size={10} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-demo-session-tab"
          data-active={activeTab === "new"}
          onClick={() => setActiveTab("new")}
        >
          <img src="/lyra-mark.svg" alt="" />
          <span>{copy.tabs.newSession}</span>
          <X size={10} aria-hidden="true" />
        </button>
        <IconButton label={copy.actions.newSession}>
          <Plus size={13} />
        </IconButton>
        <IconButton label={copy.actions.more}>
          <MoreHorizontal size={13} />
        </IconButton>
      </div>

      <div className="lyra-demo-chat">
        {sentMessage === null ? (
          <div className="lyra-demo-empty-state">
            <pre aria-label="Lyra" role="img">{LYRA_ASCII_LOGO}</pre>
            <p>
              {copy.chat.questionPrefix}
              <button type="button">{copy.chat.home}</button>
              {copy.chat.questionSuffix}
            </p>
          </div>
        ) : (
          <div className="lyra-demo-conversation">
            <p className="lyra-demo-user-message">{sentMessage}</p>
            <div className="lyra-demo-agent-message">
              <img src="/lyra-mark.svg" alt="" />
              <p>{copy.chat.reply}</p>
            </div>
          </div>
        )}

        <form className="lyra-demo-composer-wrap" onSubmit={submit}>
          <div className="lyra-demo-composer">
            <textarea
              rows={2}
              value={message}
              aria-label={copy.chat.placeholder}
              placeholder={copy.chat.placeholder}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="lyra-demo-composer-toolbar">
              <button type="button" aria-label={copy.actions.attach}>
                <Plus size={13} />
              </button>
              <button type="button" className="lyra-demo-model">
                <Sparkles size={12} />
                <span>{copy.chat.model}</span>
                <ChevronDown size={10} />
              </button>
              <button type="button" className="lyra-demo-model">
                <span>{copy.chat.permission}</span>
                <ChevronDown size={10} />
              </button>
              <button
                type="submit"
                className="lyra-demo-send"
                aria-label={copy.actions.send}
                disabled={message.trim().length === 0}
              >
                <ArrowUp size={12} />
              </button>
            </div>
          </div>
          <div className="lyra-demo-ai-footer">
            <span><Folder size={11} />{copy.chat.home}</span>
            <span><Terminal size={11} />{copy.chat.backend}</span>
            <span><FileText size={11} />{copy.chat.plan}</span>
            <span><CircleUserRound size={11} />{copy.chat.location}</span>
          </div>
        </form>
      </div>
    </aside>
  );
}

function Switch({
  checked,
  label,
  onChange
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="lyra-demo-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-checked={checked}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lyra-demo-setting-row">
      <div>
        <strong>{title}</strong>
        {description === undefined ? null : <small>{description}</small>}
      </div>
      {children}
    </div>
  );
}

function SettingsSurface({
  copy,
  locale,
  theme,
  onThemeChange,
  onLocaleChange
}: {
  readonly copy: SiteCopy["demo"];
  readonly locale: SiteLocale;
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
}) {
  const [active, setActive] = useState<SettingsId>("appearance");
  const [material, setMaterial] = useState(true);
  const settingsItems = [
    ["general", copy.settings.general],
    ["appearance", copy.settings.appearance],
    ["workspace", copy.settings.workspace],
    ["notifications", copy.settings.notifications],
    ["login", copy.settings.login],
    ["lyra", copy.settings.lyra],
    ["search", copy.settings.search],
    ["agents", copy.settings.agents],
    ["models", copy.settings.models],
    ["skills", copy.settings.skills],
    ["mcp", copy.settings.mcp],
    ["experimental", copy.settings.experimental]
  ] as const;

  return (
    <div className="lyra-demo-settings">
      <nav aria-label={copy.settings.title}>
        {settingsItems.map(([id, label]) => {
          const Icon = settingsIcons[id];
          const enabled = id === "general" || id === "appearance" || id === "workspace";
          return (
            <button
              type="button"
              key={id}
              data-active={active === id}
              disabled={!enabled}
              onClick={() => {
                if (enabled) setActive(id);
              }}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          );
        })}
        <div className="lyra-demo-settings-docs">
          <BookOpen size={13} />
          <span>{copy.settings.docs}</span>
        </div>
      </nav>

      <section className="lyra-demo-settings-main">
        {active === "appearance" ? (
          <div className="lyra-demo-settings-category">
            <h3>{copy.settings.appearance}</h3>
            <div className="lyra-demo-settings-group">
              <SettingRow title={copy.settings.theme}>
                <div className="lyra-demo-theme-choice" role="group" aria-label={copy.settings.theme}>
                  <button
                    type="button"
                    data-active={theme === "dark"}
                    onClick={() => onThemeChange("dark")}
                  >
                    <Moon size={12} />{copy.settings.dark}
                  </button>
                  <button
                    type="button"
                    data-active={theme === "light"}
                    onClick={() => onThemeChange("light")}
                  >
                    <Sun size={12} />{copy.settings.light}
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                title={copy.settings.material}
                description={copy.settings.materialDescription}
              >
                <Switch
                  checked={material}
                  label={copy.settings.material}
                  onChange={() => setMaterial((value) => !value)}
                />
              </SettingRow>
            </div>
          </div>
        ) : null}

        {active === "general" ? (
          <div className="lyra-demo-settings-category">
            <h3>{copy.settings.general}</h3>
            <div className="lyra-demo-settings-group">
              <SettingRow title={copy.settings.language}>
                <div
                  className="lyra-demo-theme-choice"
                  role="group"
                  aria-label={copy.settings.language}
                >
                  <button
                    type="button"
                    data-active={locale === "zh"}
                    lang="zh-CN"
                    onClick={() => onLocaleChange("zh")}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    data-active={locale === "en"}
                    lang="en"
                    onClick={() => onLocaleChange("en")}
                  >
                    English
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                title={copy.settings.updates}
                description={copy.settings.updatesDescription}
              >
                <span className="lyra-demo-value">{copy.settings.updatesValue}</span>
              </SettingRow>
            </div>
          </div>
        ) : null}

        {active === "workspace" ? (
          <div className="lyra-demo-settings-category">
            <h3>{copy.settings.workspace}</h3>
            <div className="lyra-demo-settings-group">
              <SettingRow title={copy.settings.terminalPosition}>
                <button type="button" className="lyra-demo-select">
                  {copy.settings.bottom}<ChevronDown size={11} />
                </button>
              </SettingRow>
              <SettingRow
                title={copy.settings.restore}
                description={copy.settings.restoreDescription}
              >
                <Switch checked label={copy.settings.restore} onChange={() => undefined} />
              </SettingRow>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HomeSurface({ copy }: { readonly copy: SiteCopy["demo"] }) {
  return (
    <div className="lyra-demo-home-surface">
      <div className="lyra-demo-home-mark">
        <img src="/lyra-mark.svg" alt="" />
        <strong>LYRA</strong>
      </div>
      <label>
        <Search size={14} />
        <input aria-label={copy.workspace.search} placeholder={copy.workspace.search} />
      </label>
      <div className="lyra-demo-home-links">
        <button type="button"><Folder size={14} />{copy.workspace.openProject}</button>
        <button type="button"><Bot size={14} />{copy.workspace.newAgent}</button>
        <button type="button"><History size={14} />{copy.workspace.recent}</button>
      </div>
    </div>
  );
}

function DocsSurface({ copy }: { readonly copy: SiteCopy["demo"] }) {
  return (
    <article className="lyra-demo-docs-surface">
      <small>{copy.workspace.docsKicker}</small>
      <h3>{copy.workspace.docsTitle}</h3>
      <p>{copy.workspace.docsBody}</p>
      <div>
        <span>{copy.workspace.docsItems[0]}</span>
        <span>{copy.workspace.docsItems[1]}</span>
        <span>{copy.workspace.docsItems[2]}</span>
      </div>
    </article>
  );
}

function BrowserTabs({
  copy,
  active,
  onChange,
  showSite
}: {
  readonly copy: SiteCopy["demo"];
  readonly active: WorkspaceId;
  readonly onChange: (id: WorkspaceId) => void;
  readonly showSite: boolean;
}) {
  const tabs = [
    ...(showSite ? [{ id: "site" as const, label: copy.tabs.site, icon: null }] : []),
    { id: "home" as const, label: copy.tabs.home, icon: House },
    { id: "settings" as const, label: copy.tabs.settings, icon: Settings2 },
    { id: "docs" as const, label: copy.tabs.docs, icon: BookOpen }
  ];

  return (
    <div className="lyra-demo-browser-tabs">
      <div className="lyra-demo-browser-toolbar">
        <IconButton label={copy.actions.back}><ChevronLeft size={13} /></IconButton>
        <IconButton label={copy.actions.forward}><ChevronRight size={13} /></IconButton>
        <IconButton label={copy.actions.layers}><Layers3 size={13} /></IconButton>
        <div className="lyra-demo-omnibox">
          <Search size={11} />
          <span>{active === "site" ? copy.workspace.siteUrl : copy.workspace.omnibox}</span>
        </div>
        <div className="lyra-demo-context-links">
          <span>{copy.settings.general}</span>
          <span>{copy.settings.appearance}</span>
          <span>{copy.settings.workspace}</span>
          <span>{copy.settings.agents}</span>
        </div>
      </div>
      <div className="lyra-demo-browser-tab-row">
        <button type="button" className="lyra-demo-file-tab">
          <Folder size={12} />{copy.tabs.files}
        </button>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className="lyra-demo-browser-tab"
            data-active={active === id}
            onClick={() => onChange(id)}
          >
            {Icon === null
              ? <img className="lyra-demo-browser-favicon" src="/lyra-mark.svg" alt="" />
              : <Icon size={12} />}
            <span>{label}</span>
          </button>
        ))}
        <IconButton label={copy.actions.history}><History size={12} /></IconButton>
        <IconButton label={copy.actions.newTab}><Plus size={12} /></IconButton>
      </div>
    </div>
  );
}

function TerminalDock({ copy }: { readonly copy: SiteCopy["demo"] }) {
  return (
    <div className="lyra-demo-terminal">
      <aside>
        <button type="button" data-active="true">
          <img src="/lyra-mark.svg" alt="" />
          <span>{copy.terminal.tab}</span>
        </button>
        <div>
          <Plus size={12} />
          <RotateCcw size={12} />
          <Layers3 size={12} />
          <PanelBottom size={12} />
        </div>
      </aside>
      <pre>
        <span>{copy.terminal.prompt}</span> {copy.terminal.command}
        {"\n"}<i>{copy.terminal.output}</i>
        {"\n"}<span>{copy.terminal.prompt}</span> <b className="lyra-demo-cursor" />
      </pre>
    </div>
  );
}

export function LyraWorkbenchDemo({
  copy,
  className = "",
  siteSurface,
  initialWorkspace = "settings",
  initialTerminalVisible = true,
  locale,
  theme,
  onThemeChange,
  onLocaleChange
}: LyraWorkbenchDemoProps) {
  const [workspace, setWorkspace] = useState<WorkspaceId>(initialWorkspace);
  const [terminalVisible, setTerminalVisible] = useState(initialTerminalVisible);
  const [aiVisible, setAiVisible] = useState(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event(LYRA_DEMO_LAYOUT_EVENT));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [aiVisible]);

  return (
    <div className={`lyra-demo-stage ${className}`.trim()}>
      <div className="lyra-demo-scroll">
        <section
          className="lyra-demo-window"
          data-theme={theme ?? undefined}
          aria-label={copy.windowLabel}
        >
          <header className="lyra-demo-titlebar">
            <div className="lyra-demo-traffic" aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className="lyra-demo-title">{copy.windowTitle}</div>
            <div className="lyra-demo-title-actions">
              <IconButton label={copy.actions.notifications}><Bell size={13} /></IconButton>
              <IconButton label={copy.actions.history}><History size={13} /></IconButton>
              <IconButton
                label={copy.actions.terminal}
                active={terminalVisible}
                onClick={() => setTerminalVisible((value) => !value)}
              >
                <PanelBottom size={13} />
              </IconButton>
              <IconButton
                label={copy.actions.settings}
                active={workspace === "settings"}
                onClick={() => setWorkspace("settings")}
              >
                <Settings2 size={13} />
              </IconButton>
              <IconButton label={copy.actions.store}><Store size={13} /></IconButton>
              <IconButton label={copy.actions.files}><Folder size={13} /></IconButton>
              <button
                type="button"
                className="lyra-demo-discuss"
                data-active={aiVisible}
                aria-label={copy.actions.discuss}
                aria-pressed={aiVisible}
                onClick={() => setAiVisible((value) => !value)}
              >
                <img src="/lyra-mark.svg" alt="" />
                <span>{copy.actions.discuss}</span>
              </button>
            </div>
          </header>

          <div className="lyra-demo-main" data-ai-visible={aiVisible}>
            {aiVisible ? <AiPanel copy={copy} /> : null}
            <div className="lyra-demo-center" data-terminal={terminalVisible}>
              <div className="lyra-demo-workspace">
                <div className="lyra-demo-workspace-content">
                  {siteSurface === undefined ? null : (
                    <div
                      className="lyra-demo-site-view"
                      data-active={workspace === "site"}
                    >
                      {siteSurface}
                    </div>
                  )}
                  {workspace === "settings" ? (
                    <SettingsSurface
                      copy={copy}
                      locale={locale}
                      theme={theme}
                      onThemeChange={onThemeChange}
                      onLocaleChange={onLocaleChange}
                    />
                  ) : null}
                  {workspace === "home" ? <HomeSurface copy={copy} /> : null}
                  {workspace === "docs" ? <DocsSurface copy={copy} /> : null}
                </div>
                <BrowserTabs
                  copy={copy}
                  active={workspace}
                  onChange={setWorkspace}
                  showSite={siteSurface !== undefined}
                />
              </div>
              {terminalVisible ? <TerminalDock copy={copy} /> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
