import { useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Lock,
  ShieldAlert,
  Globe,
  Info,
  ShieldCheck,
  AlertTriangle,
  Star
} from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type {
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserEvent,
  WorkbenchBrowserSecurityLocale,
  WorkbenchBrowserSearchInPageResult
} from "../../../shared/desktop-bridge";
import { AppIconButton, AppInput } from "@renderer/ui/components";
import { t, formatMessage } from "@workbench/i18n";
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
  readonly certificateSubjectLabel: string;
  readonly certificateSubjectCommonNameLabel: string;
  readonly certificateIssuerLabel: string;
  readonly certificateIssuerCommonNameLabel: string;
  readonly certificateValidFromLabel: string;
  readonly certificateValidToLabel: string;
  readonly certificateSerialLabel: string;
  readonly certificateFingerprintLabel: string;
  readonly certificateSubjectAltNameLabel: string;
  readonly certificateUnavailableLabel: string;
  readonly certificateNotApplicableLabel: string;
  readonly secureConnection: string;
  readonly insecureConnection: string;
  readonly localConnection: string;
  readonly unavailableReason: string;
  readonly unavailableNotHttps: string;
  readonly unavailableNoCertificate: string;
};

const DEFAULT_SECURITY_LABELS: TitlebarNavigationSecurityLabels = {
  ariaLabel: "Connection security information",
  title: "View connection security information",
  secureTitle: "Connection is secure",
  secureBody: "This page loaded over HTTPS. Lyra only shows connection and certificate information it actually read from the current page.",
  insecureTitle: "Connection is not secure",
  insecureBody: "This page did not load over HTTPS. Content on this connection may be read or changed by others on the network.",
  systemTitle: "Local or system page",
  systemBody: "This is not a remote HTTPS website. Lyra only shows the local or system origin details it can confirm.",
  connectionLabel: "Connection",
  addressLabel: "Address",
  hostLabel: "Host",
  originLabel: "Origin",
  schemeLabel: "Scheme",
  certificateSubjectLabel: "Certificate subject",
  certificateSubjectCommonNameLabel: "Certificate subject CN",
  certificateIssuerLabel: "Certificate issuer",
  certificateIssuerCommonNameLabel: "Certificate issuer CN",
  certificateValidFromLabel: "Valid from",
  certificateValidToLabel: "Valid until",
  certificateSerialLabel: "Serial number",
  certificateFingerprintLabel: "SHA-256 fingerprint",
  certificateSubjectAltNameLabel: "Subject alternative names",
  certificateUnavailableLabel: "Certificate details",
  certificateNotApplicableLabel: "Not applicable",
  secureConnection: "HTTPS",
  insecureConnection: "Unencrypted HTTP",
  localConnection: "Local/system page",
  unavailableReason: "Certificate details unavailable: {reason}",
  unavailableNotHttps: "The current page is not an HTTPS connection.",
  unavailableNoCertificate: "Chromium did not return a parsable certificate chain."
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
  readonly favoriteButton?: {
    readonly visible: boolean;
    readonly active: boolean;
    readonly label: string;
    readonly onToggle: () => void;
  };
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
  favoriteButton,
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
  locale = "en-US",
  securityLabels = DEFAULT_SECURITY_LABELS,
  activeBrowserTabId = null,
  browserChromePopoverBridge
}: TitlebarNavigationProps) => {
  const hasTrailingControl = trailingControl !== undefined && trailingControl !== null;
  const hasFavoriteButton = favoriteButton?.visible === true;
  const pageFindMode = mode === "page-find";
  const hasExternalActions =
    hasTrailingControl || hasFavoriteButton || (!pageFindMode && primaryActionKind === "reload");

  // SSL security state management
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);
  const [reloadAnimating, setReloadAnimating] = useState(false);
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
    if (primaryActionKind === "reload") {
      setReloadAnimating(false);
      window.requestAnimationFrame(() => {
        setReloadAnimating(true);
      });
    }
    void onSubmit();
  };

  useEffect(() => {
    if (!reloadAnimating) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setReloadAnimating(false);
    }, 650);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [reloadAnimating]);

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
        labels: securityLabels,
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
    securityLabels,
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
        labels: {
          ariaLabel: t("navigation.addressSuggestionAriaLabel"),
          history: t("navigation.suggestionTypeHistory"),
          searchSuggestion: t("navigation.suggestionTypeSearch"),
          emptyStart: t("navigation.omniboxEmptyStart"),
          emptyNoMatch: t("navigation.omniboxEmptyNoMatch")
        },
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
        truncated: result?.truncated === true,
        labels: {
          ariaLabel: t("navigation.pageFindResultsAriaLabel"),
          current: t("navigation.pageFindResultCurrent"),
          result: t("navigation.pageFindResultLabel"),
          emptyStart: t("navigation.pageFindEmptyStart"),
          emptyNoMatch: t("navigation.pageFindEmptyNoMatch"),
          truncationNotice: formatMessage("navigation.pageFindTruncationNotice", {
            count: result?.matches.length ?? 0
          })
        }
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
      aria-label={t("navigation.addressSuggestionAriaLabel")}
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
            {suggestion.type === "history" ? t("navigation.suggestionTypeHistory") : t("navigation.suggestionTypeSearch")}
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
      aria-label={t("navigation.pageFindResultsAriaLabel")}
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
                {selected ? t("navigation.pageFindResultCurrent") : t("navigation.pageFindResultLabel")}
              </span>
            </li>
          );
        })
      ) : (
        <li className="lyra-find-empty">
          {value.trim().length === 0 ? t("navigation.pageFindEmptyStart") : t("navigation.pageFindEmptyNoMatch")}
        </li>
      )}
      {pageFindResult?.truncated === true ? (
        <li className="lyra-find-truncated">
          {formatMessage("navigation.pageFindTruncationNotice", { count: pageFindMatches.length })}
        </li>
      ) : null}
    </ul>
  ) : null;

  return (
    <>
      <div className="lyra-titlebar-navigation lyra-no-drag">
        <form ref={navigationRef} className="lyra-titlebar-navigation-form" onSubmit={handleSubmit}>
          <div
            className={
              isContextualAddress
                ? "lyra-titlebar-navigation-shell lyra-titlebar-navigation-shell-contextual"
                : "lyra-titlebar-navigation-shell"
            }
            data-has-trailing-control={hasTrailingControl ? "true" : "false"}
            data-has-favorite-control={hasFavoriteButton ? "true" : "false"}
            data-suggestions-open={navigationShellExpanded ? "true" : "false"}
            data-mode={pageFindMode ? "page-find" : "normal"}
            data-primary-action={primaryActionKind}
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
              {pageFindMode || primaryActionKind === "submit" ? (
                <span className="lyra-titlebar-navigation-actions">
                  {pageFindMode ? (
                    <>
                      <span className="lyra-titlebar-page-find-counter">
                        {pageFindCounter}
                      </span>
                      <AppIconButton
                        className="lyra-titlebar-navigation-action"
                        aria-label={t("navigation.previousPageResult")}
                        title={t("navigation.previousPageResult")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          void onPageFindPrevious();
                        }}
                      >
                        <ChevronUp size={14} aria-hidden="true" />
                      </AppIconButton>
                      <AppIconButton
                        className="lyra-titlebar-navigation-action"
                        aria-label={t("navigation.nextPageResult")}
                        title={t("navigation.nextPageResult")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          void onPageFindNext();
                        }}
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </AppIconButton>
                    </>
                  ) : (
                    <AppIconButton
                      type="submit"
                      className="lyra-titlebar-navigation-action"
                      aria-label={submitLabel}
                      title={submitLabel}
                    >
                      <ArrowRight size={14} aria-hidden="true" />
                    </AppIconButton>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        </form>
        {hasExternalActions ? (
          <div className="lyra-titlebar-navigation-external-actions">
            {!pageFindMode && primaryActionKind === "reload" ? (
              <AppIconButton
                type="button"
                className={
                  reloadAnimating
                    ? "lyra-titlebar-navigation-action lyra-titlebar-navigation-action-reloading"
                    : "lyra-titlebar-navigation-action"
                }
                aria-label={reloadLabel}
                title={reloadLabel}
                onClick={() => navigationRef.current?.requestSubmit()}
              >
                <RefreshCw size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            {trailingControl}
            {hasFavoriteButton ? (
              <AppIconButton
                className="lyra-titlebar-navigation-action lyra-titlebar-navigation-favorite-action"
                active={favoriteButton!.active}
                aria-label={favoriteButton!.label}
                title={favoriteButton!.label}
                onClick={favoriteButton!.onToggle}
              >
                <Star
                  size={14}
                  aria-hidden="true"
                  fill={favoriteButton!.active ? "currentColor" : "none"}
                />
              </AppIconButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {showSecurityPopover && nativeSecurityPopoverTabIdRef.current === null
        ? createPortal(securityPopover, document.body)
        : null}
    </>
  );
};
