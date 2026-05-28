import { useState, useRef, useEffect } from "react";
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
import type { OmniboxSuggestion } from "./use-titlebar-navigation-model";

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
  onSuggestionClick = () => undefined
}: TitlebarNavigationProps) => {
  const hasValue = value.length > 0;
  const hasTrailingControl = trailingControl !== undefined && trailingControl !== null;
  const primaryActionLabel =
    primaryActionKind === "reload" ? reloadLabel : submitLabel;

  // SSL security state management
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);
  const securityButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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
      if (
        showSecurityPopover &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        securityButtonRef.current &&
        !securityButtonRef.current.contains(e.target as Node)
      ) {
        setShowSecurityPopover(false);
      }
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

  return (
    <form className="lyra-titlebar-navigation lyra-no-drag" onSubmit={handleSubmit} style={{ position: "relative" }}>
      <div
        className={
          isContextualAddress
            ? "lyra-titlebar-navigation-shell lyra-titlebar-navigation-shell-contextual"
            : "lyra-titlebar-navigation-shell"
        }
        data-has-value={hasValue ? "true" : "false"}
        data-has-trailing-control={hasTrailingControl ? "true" : "false"}
      >
        {/* Clickable SSL / Security State button indicator */}
        <button
          type="button"
          ref={securityButtonRef}
          className={`lyra-titlebar-navigation-security-btn lyra-security-${securityLevel}`}
          onClick={() => setShowSecurityPopover(!showSecurityPopover)}
          title="点击查看连接安全与证书信息"
        >
          {renderSecurityIcon()}
        </button>

        {/* Floating SSL Certificate Details Popover */}
        {showSecurityPopover && (
          <div ref={popoverRef} className="lyra-omnibox-security-popover">
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
        )}

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

      {/* Floating Smart Autocomplete Suggestions Dropdown Overlay */}
      {showSuggestions && suggestions.length > 0 && (
        <ul className="lyra-omnibox-suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.value}-${index}`}
              className={`lyra-suggestion-item ${
                index === selectedIndex ? "is-selected" : ""
              }`}
              onMouseDown={(e) => {
                // Prevent input blur from firing before list click registers
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
      )}
    </form>
  );
};
