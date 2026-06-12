import { useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  X,
  Lock,
  ShieldAlert,
  Globe,
  Info,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type {
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserEvent,
  WorkbenchBrowserSecurityLocale,
  WorkbenchBrowserSearchInPageResult
} from "../../../shared/desktop-bridge";
import { AppIconButton, AppInput } from "@renderer/ui/components";
import type { OmniboxSuggestion } from "./use-titlebar-navigation-model";
import { useAnchoredOverlayPosition } from "./use-anchored-overlay-position";

export type TitlebarNavigationPrimaryActionKind = "submit" | "reload";

export type TitlebarNavigationSecurityLabels = {
  readonly ariaLabel: string;
  readonly title: string;
  readonly secureTitle: string;
  readonly secureBody: string;
  readonly insecureTitle: string;
  readonly insecureBody: string;
  readonly systemTitle: string;
  readonly systemBody: string;
  readonly connectionLabel: string;
  readonly addressLabel: string;
  readonly hostLabel: string;
  readonly originLabel: string;
  readonly schemeLabel: string;
  readonly certificateUnavailableLabel: string;
  readonly certificateNotApplicableLabel: string;
  readonly secureConnection: string;
  readonly insecureConnection: string;
  readonly localConnection: string;
  readonly unavailableNotHttps: string;
  readonly unavailableNoCertificate: string;
};

const DEFAULT_SECURITY_LABELS: TitlebarNavigationSecurityLabels = {
  ariaLabel: "连接安全信息",
  title: "查看连接安全信息",
  secureTitle: "连接是安全的",
  secureBody: "此页面通过 HTTPS 加载。下面仅显示 Lyra 从当前页面实际读取到的连接信息。",
  insecureTitle: "连接不安全",
  insecureBody: "此页面未通过 HTTPS 加载，连接内容可能被网络中的其他方读取或修改。",
  systemTitle: "本地或系统页面",
  systemBody: "此页面不是远程 HTTPS 网站。下面显示当前地址可确认的本地或系统来源信息。",
  connectionLabel: "连接状态",
  addressLabel: "地址",
  hostLabel: "主机",
  originLabel: "来源",
  schemeLabel: "协议",
  certificateUnavailableLabel: "证书详情",
  certificateNotApplicableLabel: "不适用",
  secureConnection: "HTTPS",
  insecureConnection: "未加密 HTTP",
  localConnection: "本地/内置页面",
  unavailableNotHttps: "当前页面不是 HTTPS 连接。",
  unavailableNoCertificate: "当前界面无法读取证书链。"
};

type TitlebarNavigationProps = {
  readonly mode?: "normal" | "page-find";
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly primaryActionKind: TitlebarNavigationPrimaryActionKind;
  readonly isContextualAddress: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void | Promise<void>;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly trailingControl?: ReactNode;

  // New autocomplete additions:
  readonly suggestions?: readonly OmniboxSuggestion[];
  readonly selectedIndex?: number;
  readonly showSuggestions?: boolean;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onSuggestionClick?: (suggestion: OmniboxSuggestion) => void;
  readonly focusRequestKey?: number;
  readonly pageFindResult?: WorkbenchBrowserSearchInPageResult | null;
  readonly onPageFindClose?: () => void;
  readonly onPageFindNext?: () => void | Promise<void>;
  readonly onPageFindPrevious?: () => void | Promise<void>;
  readonly onPageFindMatchClick?: (index: number) => void | Promise<void>;
  readonly locale?: WorkbenchBrowserSecurityLocale;
  readonly securityLabels?: TitlebarNavigationSecurityLabels;
  readonly activeBrowserTabId?: string | null;
  readonly browserChromePopoverBridge?: {
    readonly setChromePopover?: (
      request: WorkbenchBrowserChromePopoverRequest
    ) => Promise<void>;
    readonly onEvent?: (
      listener: (event: WorkbenchBrowserEvent) => void
    ) => () => void;
  } | undefined;
};

export const TitlebarNavigation = ({
  mode = "normal",
  value,
  placeholder,
  ariaLabel,
  submitLabel,
  reloadLabel,
  primaryActionKind,
  isContextualAddress,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  trailingControl,
  suggestions = [],
  selectedIndex = -1,
  showSuggestions = false,
  onKeyDown = () => undefined,
  onSuggestionClick = () => undefined,
  focusRequestKey = 0,
  pageFindResult = null,
  onPageFindClose = () => undefined,
  onPageFindNext = () => undefined,
  onPageFindPrevious = () => undefined,
  onPageFindMatchClick = () => undefined,
  locale = "zh-CN",
  securityLabels = DEFAULT_SECURITY_LABELS,
  activeBrowserTabId = null,
  browserChromePopoverBridge
}: TitlebarNavigationProps) => {
  const hasValue = value.length > 0;
  const hasTrailingControl = trailingControl !== undefined && trailingControl !== null;
  const pageFindMode = mode === "page-find";
  const primaryActionLabel =
    primaryActionKind === "reload" ? reloadLabel : submitLabel;

  // SSL security state management
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);
  const navigationRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const securityButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLUListElement | null>(null);
  const nativeSecurityPopoverTabIdRef = useRef<string | null>(null);
  const nativeFindPopoverTabIdRef = useRef<string | null>(null);
  const nativeOmniboxPopoverTabIdRef = useRef<string | null>(null);
  const suggestionPanelOpen = !pageFindMode && showSuggestions && suggestions.length > 0;
  const canUseNativeOmniboxPopover =
    activeBrowserTabId !== null && browserChromePopoverBridge?.setChromePopover !== undefined;
  const canUseNativeFindPopover =
    pageFindMode
    && activeBrowserTabId !== null
    && browserChromePopoverBridge?.setChromePopover !== undefined;
  const nativeSuggestionPanelOpen = suggestionPanelOpen && canUseNativeOmniboxPopover;
  const inlineSuggestionPanelOpen = suggestionPanelOpen && !nativeSuggestionPanelOpen;
  const inlinePageFindPanelOpen = pageFindMode && !canUseNativeFindPopover;
  const navigationShellExpanded = suggestionPanelOpen || inlinePageFindPanelOpen;
  const pageFindMatches = pageFindMode ? pageFindResult?.matches ?? [] : [];
  const pageFindCounter = pageFindMode
    ? pageFindResult !== null && pageFindResult.totalMatches > 0
      ? `${Math.max(1, pageFindResult.currentIndex)} / ${pageFindResult.totalMatches}`
      : "0 / 0"
    : null;
  const securityPopoverPosition = useAnchoredOverlayPosition({
    open: showSecurityPopover,
    anchorRef: securityButtonRef,
    overlayRef: popoverRef,
    boundarySelector: ".lyra-workspace",
    preferredWidth: 300,
    minWidth: 260,
    maxWidth: 300,
    maxHeight: 520,
    offset: 6
  });

  // Get security level: "secure" | "insecure" | "system"
  const getSecurityLevel = (): "secure" | "insecure" | "system" => {
    const val = value.trim().toLowerCase();
    if (val.startsWith("https://")) return "secure";
    if (val.startsWith("http://")) return "insecure";
    return "system";
  };

  const securityLevel = getSecurityLevel();

  // Close security popover on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!showSecurityPopover) {
        return;
      }
      if (securityButtonRef.current?.contains(e.target as Node) === true) {
        return;
      }
      if (popoverRef.current?.contains(e.target as Node) === true) {
        return;
      }
      setShowSecurityPopover(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSecurityPopover]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmit();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value);
  };

  const renderSecurityIcon = () => {
    switch (securityLevel) {
      case "secure":
        return <Lock size={13} className="lyra-security-icon" />;
      case "insecure":
        return <ShieldAlert size={13} className="lyra-security-icon" />;
      case "system":
      default:
        return <Info size={13} className="lyra-security-icon" />;
    }
  };

  const getSecurityUrl = (url: string): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  };
  const securityUrl = getSecurityUrl(value.trim());
  const securityDomain =
    securityUrl?.hostname
    ?? value.replace(/^(https?:\/\/)?(www\.)?/u, "").split("/")[0]
    ?? "";
  const securityScheme =
    securityUrl === null ? "" : securityUrl.protocol.replace(/:$/u, "");
  const securityOrigin = securityUrl?.origin ?? "";
  const securityConnection =
    securityLevel === "secure"
      ? securityLabels.secureConnection
      : securityLevel === "insecure"
        ? securityLabels.insecureConnection
        : securityLabels.localConnection;
  const securityHeader =
    securityLevel === "secure"
      ? {
          title: securityLabels.secureTitle,
          body: securityLabels.secureBody,
          icon: <ShieldCheck size={18} className="lyra-security-popover-icon" />
        }
      : securityLevel === "insecure"
        ? {
            title: securityLabels.insecureTitle,
            body: securityLabels.insecureBody,
            icon: <AlertTriangle size={18} className="lyra-security-popover-icon" />
          }
        : {
            title: securityLabels.systemTitle,
            body: securityLabels.systemBody,
            icon: <Globe size={18} className="lyra-security-popover-icon" />
          };
  const securityRows = [
    [securityLabels.connectionLabel, securityConnection],
    [securityLabels.addressLabel, value.trim()],
    ...(securityDomain.length === 0 ? [] : [[securityLabels.hostLabel, securityDomain]]),
    ...(securityOrigin.length === 0 || securityOrigin === "null"
      ? []
      : [[securityLabels.originLabel, securityOrigin]]),
    ...(securityScheme.length === 0 ? [] : [[securityLabels.schemeLabel, securityScheme]]),
    [
      securityLabels.certificateUnavailableLabel,
      securityLevel === "secure"
        ? securityLabels.unavailableNoCertificate
        : securityLabels.unavailableNotHttps
    ]
  ] as const;

  const canUseNativeSecurityPopover =
    activeBrowserTabId !== null && browserChromePopoverBridge?.setChromePopover !== undefined;

  const hideNativeSecurityPopover = useCallback((): void => {
    const tabId = nativeSecurityPopoverTabIdRef.current;
    nativeSecurityPopoverTabIdRef.current = null;
    if (tabId === null || browserChromePopoverBridge?.setChromePopover === undefined) {
      return;
    }
    void browserChromePopoverBridge.setChromePopover({
      tabId,
      kind: "security",
      visible: false
    }).catch(() => undefined);
  }, [browserChromePopoverBridge]);

  const hideNativeOmniboxPopover = useCallback((): void => {
    const tabId = nativeOmniboxPopoverTabIdRef.current;
    nativeOmniboxPopoverTabIdRef.current = null;
    if (tabId === null || browserChromePopoverBridge?.setChromePopover === undefined) {
      return;
    }
    void browserChromePopoverBridge.setChromePopover({
      tabId,
      kind: "omnibox",
      visible: false
    }).catch(() => undefined);
  }, [browserChromePopoverBridge]);

  const hideNativeFindPopover = useCallback((): void => {
    const tabId = nativeFindPopoverTabIdRef.current;
    nativeFindPopoverTabIdRef.current = null;
    if (tabId === null || browserChromePopoverBridge?.setChromePopover === undefined) {
      return;
    }
    void browserChromePopoverBridge.setChromePopover({
      tabId,
      kind: "find",
      visible: false
    }).catch(() => undefined);
  }, [browserChromePopoverBridge]);

  const showNativeSecurityPopover = useCallback((): boolean => {
    if (
      activeBrowserTabId === null
      || browserChromePopoverBridge?.setChromePopover === undefined
      || securityButtonRef.current === null
    ) {
      return false;
    }
    const rect = securityButtonRef.current.getBoundingClientRect();
    nativeSecurityPopoverTabIdRef.current = activeBrowserTabId;
    void browserChromePopoverBridge.setChromePopover({
      tabId: activeBrowserTabId,
      kind: "security",
      visible: true,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      security: {
        level: securityLevel,
        locale,
        address: value,
        domain: securityDomain,
        ...(securityScheme.length === 0 ? {} : { scheme: securityScheme }),
        ...(securityOrigin.length === 0 || securityOrigin === "null" ? {} : { origin: securityOrigin }),
        certificateStatus: securityLevel === "secure" ? "unavailable" : "not-applicable",
        certificateUnavailableReason:
          securityLevel === "secure"
            ? securityLabels.unavailableNoCertificate
            : securityLabels.unavailableNotHttps
      }
    }).catch(() => {
      nativeSecurityPopoverTabIdRef.current = null;
      setShowSecurityPopover(false);
    });
    return true;
  }, [
    activeBrowserTabId,
    browserChromePopoverBridge,
    locale,
    securityDomain,
    securityLabels.unavailableNoCertificate,
    securityLabels.unavailableNotHttps,
    securityLevel,
    securityOrigin,
    securityScheme,
    value
  ]);

  useEffect(() => () => {
    hideNativeSecurityPopover();
    hideNativeFindPopover();
    hideNativeOmniboxPopover();
  }, [hideNativeFindPopover, hideNativeOmniboxPopover, hideNativeSecurityPopover]);

  useEffect(() => {
    if (focusRequestKey <= 0) {
      return;
    }
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.focus();
    input.select();
  }, [focusRequestKey]);

  useEffect(() => {
    if (browserChromePopoverBridge?.onEvent === undefined) {
      return undefined;
    }
    return browserChromePopoverBridge.onEvent((event) => {
      if (
        event.kind === "chrome-popover-state"
        && event.popoverKind === "security"
        && event.tabId === activeBrowserTabId
        && event.visible === false
      ) {
        nativeSecurityPopoverTabIdRef.current = null;
        setShowSecurityPopover(false);
      }
      if (
        event.kind === "chrome-popover-state"
        && event.popoverKind === "omnibox"
        && event.tabId === activeBrowserTabId
        && event.visible === false
      ) {
        nativeOmniboxPopoverTabIdRef.current = null;
      }
      if (
        event.kind === "chrome-popover-state"
        && event.popoverKind === "find"
        && event.tabId === activeBrowserTabId
        && event.visible === false
      ) {
        nativeFindPopoverTabIdRef.current = null;
      }
      if (
        event.kind === "request-omnibox-suggestion-select"
        && event.tabId === activeBrowserTabId
      ) {
        const suggestion = suggestions[event.index];
        if (suggestion !== undefined) {
          onSuggestionClick(suggestion);
        }
      }
    });
  }, [
    activeBrowserTabId,
    browserChromePopoverBridge,
    onSuggestionClick,
    suggestions
  ]);

  useEffect(() => {
    if (showSecurityPopover === false) {
      hideNativeSecurityPopover();
      return;
    }
    if (nativeSecurityPopoverTabIdRef.current === null) {
      return;
    }
    if (
      canUseNativeSecurityPopover === false
      || nativeSecurityPopoverTabIdRef.current !== activeBrowserTabId
    ) {
      setShowSecurityPopover(false);
      hideNativeSecurityPopover();
    }
  }, [
    activeBrowserTabId,
    canUseNativeSecurityPopover,
    hideNativeSecurityPopover,
    showSecurityPopover
  ]);

  useEffect(() => {
    if (
      !nativeSuggestionPanelOpen
      || activeBrowserTabId === null
      || browserChromePopoverBridge?.setChromePopover === undefined
      || navigationRef.current === null
    ) {
      hideNativeOmniboxPopover();
      return;
    }
    const rect = navigationRef.current.getBoundingClientRect();
    nativeOmniboxPopoverTabIdRef.current = activeBrowserTabId;
    void browserChromePopoverBridge.setChromePopover({
      tabId: activeBrowserTabId,
      kind: "omnibox",
      visible: true,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      omnibox: {
        value,
        selectedIndex,
        suggestions: suggestions.map((suggestion) => ({
          value: suggestion.value,
          type: suggestion.type,
          ...(suggestion.label === undefined ? {} : { label: suggestion.label })
        }))
      }
    }).catch(() => {
      nativeOmniboxPopoverTabIdRef.current = null;
    });
  }, [
    activeBrowserTabId,
    browserChromePopoverBridge,
    hideNativeOmniboxPopover,
    nativeSuggestionPanelOpen,
    selectedIndex,
    suggestions,
    value
  ]);

  useEffect(() => {
    if (
      !canUseNativeFindPopover
      || activeBrowserTabId === null
      || browserChromePopoverBridge?.setChromePopover === undefined
      || navigationRef.current === null
    ) {
      hideNativeFindPopover();
      return;
    }
    const rect = navigationRef.current.getBoundingClientRect();
    nativeFindPopoverTabIdRef.current = activeBrowserTabId;
    const result = pageFindResult;
    void browserChromePopoverBridge.setChromePopover({
      tabId: activeBrowserTabId,
      kind: "find",
      visible: true,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      find: {
        query: result?.query ?? value,
        currentIndex: result?.currentIndex ?? 0,
        totalMatches: result?.totalMatches ?? 0,
        ...(result?.activeMatchId === undefined ? {} : { activeMatchId: result.activeMatchId }),
        matches: result?.matches ?? [],
        truncated: result?.truncated === true
      }
    }).catch(() => {
      nativeFindPopoverTabIdRef.current = null;
    });
  }, [
    activeBrowserTabId,
    browserChromePopoverBridge,
    canUseNativeFindPopover,
    hideNativeFindPopover,
    pageFindResult,
    value
  ]);

  const securityPopover = (
    <div
      ref={popoverRef}
      className={`lyra-omnibox-security-popover lyra-security-${securityLevel}`}
      role="dialog"
      aria-label={securityLabels.ariaLabel}
      data-placement={securityPopoverPosition.placement}
      style={securityPopoverPosition.style}
    >
      <div className="lyra-security-popover-header">
        {securityHeader.icon}
        <div>
          <h3>{securityHeader.title}</h3>
          <p>{securityHeader.body}</p>
        </div>
      </div>
      <div className="lyra-security-details-list">
        {securityRows
          .filter((row) => row[1].trim().length > 0)
          .map(([label, rowValue]) => (
            <div key={label} className="lyra-security-detail-item">
              <strong>{label}</strong>
              <span>{rowValue}</span>
            </div>
          ))}
      </div>
    </div>
  );

  const suggestionsList = (
    <ul
      ref={suggestionsRef}
      className="lyra-omnibox-suggestions"
      role="listbox"
      aria-label="地址建议"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.value}-${index}`}
          role="option"
          aria-selected={index === selectedIndex}
          className={`lyra-suggestion-item ${
            index === selectedIndex ? "is-selected" : ""
          }`}
          onMouseDown={(e) => {
            // Prevent input blur from firing before list click registers.
            e.preventDefault();
            onSuggestionClick(suggestion);
          }}
        >
          <div className="lyra-suggestion-left">
            {suggestion.type === "history" && <Globe size={13} />}
            {suggestion.type === "search" && <Search size={13} />}
            <span className="lyra-suggestion-text">
              {suggestion.value} {suggestion.label ? `(${suggestion.label})` : ""}
            </span>
          </div>
          <span className="lyra-suggestion-type-badge">
            {suggestion.type === "history" ? "历史" : "搜索建议"}
          </span>
        </li>
      ))}
    </ul>
  );

  const renderPageFindSnippet = (snippet: string): ReactNode => {
    const trimmedQuery = value.trim();
    if (trimmedQuery.length === 0) {
      return snippet;
    }
    const lowerSnippet = snippet.toLocaleLowerCase();
    const lowerQuery = trimmedQuery.toLocaleLowerCase();
    const index = lowerSnippet.indexOf(lowerQuery);
    if (index < 0) {
      return snippet;
    }
    return (
      <>
        {snippet.slice(0, index)}
        <mark>{snippet.slice(index, index + trimmedQuery.length)}</mark>
        {snippet.slice(index + trimmedQuery.length)}
      </>
    );
  };

  const pageFindResultsList = inlinePageFindPanelOpen ? (
    <ul
      ref={suggestionsRef}
      className="lyra-omnibox-suggestions"
      role="listbox"
      aria-label="网页内容搜索结果"
    >
      {pageFindMatches.length > 0 ? (
        pageFindMatches.map((match) => {
          const selected =
            match.id === pageFindResult?.activeMatchId
            || match.index === pageFindResult?.currentIndex;
          return (
            <li
              key={match.id}
              role="option"
              aria-selected={selected}
              className={`lyra-suggestion-item ${selected ? "is-selected" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                void onPageFindMatchClick(match.index);
              }}
            >
              <div className="lyra-suggestion-left">
                <span className="lyra-find-result-index">#{match.index}</span>
                <span className="lyra-suggestion-text">
                  {renderPageFindSnippet(match.snippet)}
                </span>
              </div>
              <span className="lyra-suggestion-type-badge">
                {selected ? "当前" : "结果"}
              </span>
            </li>
          );
        })
      ) : (
        <li className="lyra-find-empty">
          {value.trim().length === 0 ? "输入网页内容开始搜索" : "未找到匹配结果"}
        </li>
      )}
      {pageFindResult?.truncated === true ? (
        <li className="lyra-find-truncated">
          仅显示前 {pageFindMatches.length} 个结果。
        </li>
      ) : null}
    </ul>
  ) : null;

  return (
    <>
      <form ref={navigationRef} className="lyra-titlebar-navigation lyra-no-drag" onSubmit={handleSubmit}>
        <div
          className={
            isContextualAddress
              ? "lyra-titlebar-navigation-shell lyra-titlebar-navigation-shell-contextual"
              : "lyra-titlebar-navigation-shell"
          }
          data-has-value={hasValue ? "true" : "false"}
          data-has-trailing-control={hasTrailingControl ? "true" : "false"}
          data-suggestions-open={navigationShellExpanded ? "true" : "false"}
          data-mode={pageFindMode ? "page-find" : "normal"}
          data-native-find-open="false"
        >
          {pageFindResultsList}
          {inlineSuggestionPanelOpen ? suggestionsList : null}
          <div className="lyra-titlebar-navigation-row">
            <AppIconButton
              ref={securityButtonRef}
              className={`lyra-titlebar-navigation-security-btn lyra-security-${securityLevel}`}
              active={showSecurityPopover}
              aria-label={securityLabels.ariaLabel}
              onClick={() => {
                if (showSecurityPopover || nativeSecurityPopoverTabIdRef.current !== null) {
                  setShowSecurityPopover(false);
                  hideNativeSecurityPopover();
                  return;
                }
                if (canUseNativeSecurityPopover && showNativeSecurityPopover()) {
                  setShowSecurityPopover(true);
                  return;
                }
                setShowSecurityPopover(true);
              }}
              title={securityLabels.title}
            >
              {renderSecurityIcon()}
            </AppIconButton>

            <AppInput
              ref={inputRef}
              className="lyra-titlebar-navigation-input"
              type="text"
              value={value}
              placeholder={placeholder}
              aria-label={ariaLabel}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={handleChange}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
            />
            <span className="lyra-titlebar-navigation-actions">
              {trailingControl}
              {hasValue ? (
                <AppIconButton
                  className="lyra-titlebar-navigation-action"
                  aria-label={`Clear ${ariaLabel}`}
                  title={`Clear ${ariaLabel}`}
                  onClick={() => {
                    onChange("");
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </AppIconButton>
              ) : null}
              {pageFindMode ? (
                <>
                  <span className="lyra-titlebar-page-find-counter">
                    {pageFindCounter}
                  </span>
                  <AppIconButton
                    className="lyra-titlebar-navigation-action"
                    aria-label="Previous page result"
                    title="Previous page result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      void onPageFindPrevious();
                    }}
                  >
                    <ChevronUp size={14} aria-hidden="true" />
                  </AppIconButton>
                  <AppIconButton
                    className="lyra-titlebar-navigation-action"
                    aria-label="Next page result"
                    title="Next page result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      void onPageFindNext();
                    }}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </AppIconButton>
                </>
              ) : null}
              {!pageFindMode ? (
                <AppIconButton
                  type="submit"
                  className="lyra-titlebar-navigation-action"
                  aria-label={primaryActionLabel}
                  title={primaryActionLabel}
                >
                  {primaryActionKind === "reload" ? (
                    <RefreshCw size={14} aria-hidden="true" />
                  ) : (
                    <ArrowRight size={14} aria-hidden="true" />
                  )}
                </AppIconButton>
              ) : null}
            </span>
          </div>
        </div>
      </form>
      {showSecurityPopover && nativeSecurityPopoverTabIdRef.current === null
        ? createPortal(securityPopover, document.body)
        : null}
    </>
  );
};
