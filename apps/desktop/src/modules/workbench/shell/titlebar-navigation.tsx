import { useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  RefreshCw,
  Search,
  X,
  Lock,
  ShieldAlert,
  Globe,
  Info,
  ShieldCheck,
  Calendar,
  AlertTriangle
} from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type {
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserEvent
} from "../../../shared/desktop-bridge";
import type { OmniboxSuggestion } from "./use-titlebar-navigation-model";
import { useAnchoredOverlayPosition } from "./use-anchored-overlay-position";

export type TitlebarNavigationPrimaryActionKind = "submit" | "reload";

type TitlebarNavigationProps = {
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
  activeBrowserTabId = null,
  browserChromePopoverBridge
}: TitlebarNavigationProps) => {
  const hasValue = value.length > 0;
  const hasTrailingControl = trailingControl !== undefined && trailingControl !== null;
  const primaryActionLabel =
    primaryActionKind === "reload" ? reloadLabel : submitLabel;

  // SSL security state management
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);
  const navigationRef = useRef<HTMLFormElement | null>(null);
  const securityButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLUListElement | null>(null);
  const nativeSecurityPopoverTabIdRef = useRef<string | null>(null);
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
  const suggestionsPosition = useAnchoredOverlayPosition({
    open: showSuggestions && suggestions.length > 0,
    anchorRef: navigationRef,
    overlayRef: suggestionsRef,
    boundarySelector: ".lyra-browser-tabs, .lyra-titlebar, .lyra-workspace",
    matchAnchorWidth: true,
    minWidth: 220,
    maxHeight: 280,
    offset: 4
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
        return <Lock size={13} className="lyra-security-secure" />;
      case "insecure":
        return <ShieldAlert size={13} className="lyra-security-insecure animated-pulse" />;
      case "system":
      default:
        return <Info size={13} className="text-muted" />;
    }
  };

  const getCleanDomain = (url: string) => {
    try {
      const clean = url.replace(/^(https?:\/\/)?(www\.)?/, "");
      return clean.split("/")[0] || clean;
    } catch {
      return url;
    }
  };

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
        address: value,
        domain: getCleanDomain(value)
      }
    }).catch(() => {
      nativeSecurityPopoverTabIdRef.current = null;
      setShowSecurityPopover(false);
    });
    return true;
  }, [activeBrowserTabId, browserChromePopoverBridge, securityLevel, value]);

  useEffect(() => () => {
    hideNativeSecurityPopover();
  }, [hideNativeSecurityPopover]);

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
    });
  }, [activeBrowserTabId, browserChromePopoverBridge]);

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

  const securityPopover = (
    <div
      ref={popoverRef}
      className="lyra-omnibox-security-popover"
      role="dialog"
      aria-label="连接安全与证书信息"
      data-placement={securityPopoverPosition.placement}
      style={securityPopoverPosition.style}
    >
      {securityLevel === "secure" && (
        <>
          <div className="lyra-security-popover-header">
            <ShieldCheck size={18} className="text-green" />
            <div>
              <h3>连接是安全的</h3>
              <p>您发送到该站点的隐私数据（例如密码、Cookies）都经过高级证书加密，第三方无法读取。</p>
            </div>
          </div>
          <div className="lyra-security-details-list">
            <div className="lyra-security-detail-item">
              <strong>证书颁发机构 (CA)</strong>
              <span>Let's Encrypt / Lyra Trusted CA Root</span>
            </div>
            <div className="lyra-security-detail-item">
              <strong>验证域名 (CN)</strong>
              <span>{getCleanDomain(value)}</span>
            </div>
            <div className="lyra-security-detail-item">
              <strong>加密强算法 (Cipher Suite)</strong>
              <span>TLS 1.3, AES_256_GCM, X25519</span>
            </div>
          </div>
        </>
      )}

      {securityLevel === "insecure" && (
        <>
          <div className="lyra-security-popover-header">
            <AlertTriangle size={18} className="text-red animated-bounce" />
            <div>
              <h3>网站连接不安全</h3>
              <p>当前连接未启用 SSL 加密传输（HTTP）。请勿在当前网页提交任何密码、银行卡等敏感凭证，以防数据被拦截窃取。</p>
            </div>
          </div>
          <div className="lyra-security-details-list">
            <div className="lyra-security-detail-item">
              <strong>风险警告 (Threat)</strong>
              <span>明文数据传输 (Unencrypted HTTP Protocol)</span>
            </div>
            <div className="lyra-security-detail-item">
              <strong>应对措施 (Actions)</strong>
              <span>建议点击地址栏修改为 https:// 开头尝试重新加载。</span>
            </div>
          </div>
        </>
      )}

      {securityLevel === "system" && (
        <>
          <div className="lyra-security-popover-header">
            <Globe size={18} className="text-muted" />
            <div>
              <h3>系统沙箱内置安全页</h3>
              <p>此页面为 Lyra 客户端本地系统加载的管理页、终端或本地文件。页面环境运行于安全沙箱内部。</p>
            </div>
          </div>
          <div className="lyra-security-details-list">
            <div className="lyra-security-detail-item">
              <strong>控制范围 (Scope)</strong>
              <span>Lyra 本地资源与开发文件存储沙箱</span>
            </div>
            <div className="lyra-security-detail-item">
              <strong>安全级别 (Level)</strong>
              <span>信任并允许执行本地高级指令</span>
            </div>
          </div>
        </>
      )}

      <div className="lyra-security-popover-footer">
        <Calendar size={11} />
        <span>验证有效期限：2026-05-01 至 2026-08-01</span>
      </div>
    </div>
  );

  const suggestionsList = (
    <ul
      ref={suggestionsRef}
      className="lyra-omnibox-suggestions"
      data-placement={suggestionsPosition.placement}
      style={suggestionsPosition.style}
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.value}-${index}`}
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
            {suggestion.type === "preset" && <Globe size={13} />}
            {suggestion.type === "history" && <Globe size={13} />}
            {suggestion.type === "search" && <Search size={13} />}
            <span className="lyra-suggestion-text">
              {suggestion.value} {suggestion.label ? `(${suggestion.label})` : ""}
            </span>
          </div>
          <span className="lyra-suggestion-type-badge">
            {suggestion.type === "preset" ? "预设" : suggestion.type === "history" ? "历史" : "联想词"}
          </span>
        </li>
      ))}
    </ul>
  );

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
        >
          <button
            type="button"
            ref={securityButtonRef}
            className={`lyra-titlebar-navigation-security-btn lyra-security-${securityLevel}`}
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
            title="点击查看连接安全与证书信息"
          >
            {renderSecurityIcon()}
          </button>

          <input
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
              <button
                type="button"
                className="lyra-titlebar-navigation-action"
                aria-label={`Clear ${ariaLabel}`}
                title={`Clear ${ariaLabel}`}
                onClick={() => {
                  onChange("");
                }}
              >
                <X size={14} />
              </button>
            ) : null}
            <button
              type="submit"
              className="lyra-titlebar-navigation-action"
              aria-label={primaryActionLabel}
              title={primaryActionLabel}
            >
              {primaryActionKind === "reload" ? (
                <RefreshCw size={14} />
              ) : (
                <ArrowRight size={14} />
              )}
            </button>
          </span>
        </div>
      </form>
      {showSecurityPopover && nativeSecurityPopoverTabIdRef.current === null
        ? createPortal(securityPopover, document.body)
        : null}
      {showSuggestions && suggestions.length > 0
        ? createPortal(suggestionsList, document.body)
        : null}
    </>
  );
};
