import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode
} from "react";
import type {
  AuthLocalePreference,
  AuthLocalIdentity,
  AuthSnapshot,
  AuthUser
} from "../../shared/auth";
import type { InstalledLanguagePack } from "../../shared/language-packs";
import type { WorkbenchThemeId } from "@workbench/theme";
import {
  createTranslator,
  setWorkbenchLocale,
  useWorkbenchLocaleSnapshot
} from "@workbench/i18n";
import {
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars as resolveThemeVariables,
  resolveWorkbenchThemeId
} from "@workbench/theme";
import { AppButton } from "@renderer/ui/components";
import { Volume2, VolumeX } from "lucide-react";
import {
  getDesktopApi,
  syncCssVarsToDocumentRoot,
  syncWindowThemeSource
} from "@workbench/shell/service";
import { writeClipboardText } from "../../shared/clipboard";
import {
  hasCompletedLocalStartup,
  markLocalStartupComplete,
  persistStartupPreferences
} from "./startup-preferences";
import { resolveStartupLocale } from "./startup-locale";
import { LYRA_ASCII_LOGO } from "@workbench/ai-panel/lyra-agents/features/chat/ascii-logo";
import startupAudioUrl from "../assets/audio/mountain-moon-mission.mp3";

type StartupGateProps = {
  readonly onReady: () => void;
};

type StartupView =
  | "loading"
  | "landing"
  | "authenticating"
  | "welcome-signup"
  | "welcome-login"
  | "language"
  | "theme";

type LocaleChoice = {
  readonly id: string;
  readonly label: string;
  readonly preference: AuthLocalePreference;
};

type StartupHoverIntent =
  | "default"
  | "terms"
  | "privacy"
  | "local"
  | "login"
  | "signup"
  | "tagline"
  | "audio"
  | "logo"
  | "brand";

type StartupAudioState = {
  readonly isEnabled: boolean;
  readonly manuallyToggled: boolean;
  readonly autoplayFailed: boolean;
};

const TERMS_URL = "https://lyra.ltd/legal/terms";
const PRIVACY_URL = "https://lyra.ltd/legal/privacy";

const isChinese = (locale: string): boolean => locale.toLowerCase().startsWith("zh");

const userName = (user: AuthUser | null): string =>
  user?.displayName?.trim() || user?.email?.split("@")[0] || "there";

const EASTER_EGG_COPY = {
  zh: "我好累，压力好大，很焦虑",
  en: "I'm so tired, under so much pressure, and really anxious."
} as const;

const AnimatedAsciiLogo = () => {
  return (
    <pre
      className="lyra-startup-ascii-logo"
      aria-label="Lyra"
      role="img"
    >
      {LYRA_ASCII_LOGO}
    </pre>
  );
};

const AnimatedStartupCopy = ({
  text,
  measureRef,
  ariaHidden = false
}: {
  readonly text: string;
  readonly measureRef?: RefObject<HTMLSpanElement>;
  readonly ariaHidden?: boolean;
}) => (
  <span
    ref={measureRef}
    className="lyra-startup-tagline-copy"
    aria-hidden={ariaHidden}
  >
    {Array.from(text).map((character, index) => (
      <span
        key={`${character}-${index}`}
        className="lyra-startup-tagline-character"
        style={{
          "--lyra-startup-copy-delay": `${index * 22}ms`
        } as CSSProperties}
      >
        {character === " " ? "\u00a0" : character}
      </span>
    ))}
  </span>
);

const StartupTagline = ({
  text,
  onHover,
  onLeave
}: {
  readonly text: string;
  readonly onHover: () => void;
  readonly onLeave: () => void;
}) => {
  const viewportRef = useRef<HTMLParagraphElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (viewport === null || measure === null) {
      return;
    }
    const updateOverflow = (): void => {
      setIsOverflowing(measure.getBoundingClientRect().width > viewport.clientWidth + 1);
    };
    updateOverflow();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOverflow);
    observer?.observe(viewport);
    observer?.observe(measure);
    return () => observer?.disconnect();
  }, [text]);

  return (
    <p
      ref={viewportRef}
      className={`lyra-startup-tagline${isOverflowing ? " is-overflowing" : ""}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span key={text} className="lyra-startup-tagline-track">
        <AnimatedStartupCopy text={text} measureRef={measureRef} />
        {isOverflowing ? (
          <AnimatedStartupCopy text={text} ariaHidden />
        ) : null}
      </span>
    </p>
  );
};

const StartupPreferenceTitle = ({ text }: { readonly text: string }) => {
  const viewportRef = useRef<HTMLHeadingElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (viewport === null || measure === null) {
      return;
    }
    const updateOverflow = (): void => {
      setIsOverflowing(measure.getBoundingClientRect().width > viewport.clientWidth + 1);
    };
    updateOverflow();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOverflow);
    observer?.observe(viewport);
    observer?.observe(measure);
    return () => observer?.disconnect();
  }, [text]);

  return (
    <h1
      ref={viewportRef}
      className={`lyra-startup-preference-title${isOverflowing ? " is-overflowing" : ""}`}
    >
      <span key={text} className="lyra-startup-preference-title-track">
        <AnimatedStartupCopy text={text} measureRef={measureRef} />
        {isOverflowing ? <AnimatedStartupCopy text={text} ariaHidden /> : null}
      </span>
    </h1>
  );
};

const StartupAudioControl = ({
  onHover,
  onLeave,
  onStateChange
}: {
  readonly onHover: () => void;
  readonly onLeave: () => void;
  readonly onStateChange: (state: StartupAudioState) => void;
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const [manuallyToggled, setManuallyToggled] = useState(false);
  const [autoplayFailed, setAutoplayFailed] = useState(false);

  const updateState = (next: StartupAudioState): void => {
    setIsEnabled(next.isEnabled);
    setManuallyToggled(next.manuallyToggled);
    setAutoplayFailed(next.autoplayFailed);
    onStateChange(next);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    audio.volume = 0.18;
    void audio.play().then(
      () => updateState({ isEnabled: true, manuallyToggled: false, autoplayFailed: false }),
      () => updateState({ isEnabled: false, manuallyToggled: false, autoplayFailed: true })
    );
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  const toggleAudio = (): void => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (audio.paused) {
      void audio.play().then(
        () => updateState({ isEnabled: true, manuallyToggled: true, autoplayFailed: false }),
        () => updateState({ isEnabled: false, manuallyToggled: true, autoplayFailed: true })
      );
      return;
    }
    audio.pause();
    updateState({ isEnabled: false, manuallyToggled: true, autoplayFailed: false });
  };

  const Icon = isEnabled ? Volume2 : VolumeX;
  return (
    <>
      <audio
        ref={audioRef}
        className="lyra-startup-audio"
        src={startupAudioUrl}
        autoPlay
        loop
        preload="auto"
      />
      <button
        className={`lyra-startup-audio-toggle${isEnabled ? "" : " is-muted"}`}
        type="button"
        aria-label={isEnabled ? "Mute startup music" : "Play startup music"}
        aria-pressed={isEnabled}
        title={isEnabled ? "Mute startup music" : "Play startup music"}
        onClick={toggleAudio}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </>
  );
};

const useStartupTheme = (
  theme: WorkbenchThemeId,
  desktopApi: ReturnType<typeof getDesktopApi>
): void => {
  const [prefersDark, setPrefersDark] = useState(readSystemPrefersDark);
  useEffect(() => observeSystemPrefersDark(setPrefersDark), []);
  useLayoutEffect(() => {
    const vars = resolveThemeVariables(theme, prefersDark);
    const resolvedTheme = resolveWorkbenchThemeId(theme, prefersDark);
    syncCssVarsToDocumentRoot(vars);
    document.documentElement.dataset.lyraThemeTone =
      resolvedTheme.endsWith("-dark") ? "dark" : "light";
    document.documentElement.style.colorScheme =
      resolvedTheme.endsWith("-dark") ? "dark" : "light";
    syncWindowThemeSource(desktopApi, theme);
  }, [desktopApi, prefersDark, theme]);
};

const Avatar = ({ user }: { readonly user: AuthUser }) => {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const avatarUrl = user.avatarUrl;
  if (avatarUrl === undefined || failedUrl === avatarUrl) {
    return (
      <span className="lyra-startup-avatar-fallback">
        {userName(user).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="lyra-startup-avatar"
      src={avatarUrl}
      alt=""
      onError={() => setFailedUrl(avatarUrl)}
    />
  );
};

const LocalIdentityAvatar = ({ identity }: { readonly identity: AuthLocalIdentity }) => {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const avatarUrl = identity.registeredAvatarUrl;
  if (avatarUrl === undefined || failedUrl === avatarUrl) {
    return (
      <span className="lyra-startup-login-avatar-fallback" aria-hidden="true">
        {(identity.registeredDisplayName ?? identity.displayName).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="lyra-startup-login-avatar-image"
      src={avatarUrl}
      alt=""
      onError={() => setFailedUrl(avatarUrl)}
    />
  );
};

const ThemePreview = ({
  theme,
  selected,
  label,
  onSelect
}: {
  readonly theme: WorkbenchThemeId;
  readonly selected: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}) => (
  <button
    type="button"
    className={`lyra-startup-theme-card${selected ? " is-selected" : ""}`}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className={`lyra-startup-theme-preview lyra-startup-theme-preview-${theme.slice(5)}`}>
      <span className="lyra-startup-preview-bar" />
      <span className="lyra-startup-preview-body">
        <span className="lyra-startup-preview-sidebar" />
        <span className="lyra-startup-preview-content">
          <span />
          <span />
          <span />
        </span>
      </span>
    </span>
    <span className="lyra-startup-theme-card-label">
      {label}
      {selected ? <span aria-hidden="true">✓</span> : null}
    </span>
  </button>
);

export const StartupGate = ({ onReady }: StartupGateProps) => {
  const desktopApi = getDesktopApi();
  const { locale: activeLocale, revision: localeRevision } = useWorkbenchLocaleSnapshot();
  const [startupLocale, setStartupLocale] = useState(activeLocale);
  const viewRef = useRef<StartupView>("loading");
  const [view, setViewState] = useState<StartupView>("loading");
  const setView = useCallback((nextView: StartupView): void => {
    viewRef.current = nextView;
    setViewState(nextView);
  }, []);
  const [localeChoice, setLocaleChoice] = useState<AuthLocalePreference>({ mode: "system" });
  const [resolvedLocale, setResolvedLocale] = useState("en-US");
  const displayLocale =
    view === "language" || view === "theme"
      ? localeChoice.mode === "explicit"
        ? localeChoice.locale
        : resolvedLocale
      : startupLocale;
  const translate = useMemo(
    () => createTranslator(displayLocale),
    [displayLocale, localeRevision]
  );
  const language = {
    login: translate("startup.action.login"),
    signup: translate("startup.action.signup"),
    local: translate("startup.action.local"),
    terms: translate("startup.action.terms"),
    privacy: translate("startup.action.privacy"),
    checking: translate("startup.state.checking"),
    downloading: translate("startup.state.downloading"),
    browser: translate("startup.state.browser"),
    cancel: translate("startup.action.cancel"),
    back: translate("startup.action.back"),
    cancelHover: translate("startup.hover.cancel"),
    copyAuthUrl: translate("startup.action.copyAuthUrl"),
    copiedAuthUrl: translate("startup.state.copiedAuthUrl"),
    welcome: translate("startup.welcome.newUser"),
    welcomeBack: (name: string) => translate("startup.welcome.back", { name }),
    chooseLanguage: translate("startup.preference.chooseLanguage"),
    chooseTheme: translate("startup.preference.chooseTheme"),
    followSystem: translate("startup.preference.followSystem"),
    chinese: translate("startup.preference.chinese"),
    english: translate("startup.preference.english"),
    systemTheme: translate("startup.preference.systemTheme"),
    dark: translate("startup.preference.dark"),
    light: translate("startup.preference.light"),
    continue: translate("startup.action.continue"),
    configured: translate("startup.error.notConfigured"),
    authError: translate("startup.error.authFailed")
  };
  const configuredErrorRef = useRef(language.configured);
  configuredErrorRef.current = language.configured;
  const startupCopy = {
    slogans: [
      translate("startup.slogan.primary"),
      translate("startup.slogan.possible"),
      translate("startup.slogan.agents"),
      translate("startup.slogan.anywhere")
    ],
    terms: translate("startup.hover.terms"),
    privacy: translate("startup.hover.privacy"),
    local: translate("startup.hover.local"),
    login: translate("startup.hover.login"),
    signup: translate("startup.hover.signup"),
    taglineHover: translate("startup.hover.tagline"),
    audioPlaying: translate("startup.hover.audioPlaying"),
    audioMuted: translate("startup.hover.audioMuted"),
    audioUnavailable: translate("startup.hover.audioUnavailable"),
    logo: translate("startup.hover.logo"),
    brand: translate("startup.hover.brand")
  };
  const [auth, setAuth] = useState<AuthSnapshot | null>(null);
  const [localIdentity, setLocalIdentity] = useState<AuthLocalIdentity | null>(null);
  const [authIntent, setAuthIntent] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [isAuthUrlHovered, setIsAuthUrlHovered] = useState(false);
  const [isAuthUrlCopied, setIsAuthUrlCopied] = useState(false);
  const [isCancelHovered, setIsCancelHovered] = useState(false);
  const [downloadedLocale, setDownloadedLocale] = useState<string | undefined>();
  const [theme, setTheme] = useState<WorkbenchThemeId>("lyra-system");
  const [hoverIntent, setHoverIntent] = useState<StartupHoverIntent>("default");
  const [sloganIndex, setSloganIndex] = useState(0);
  const [isEasterEggActive, setIsEasterEggActive] = useState(false);
  const logoClickCountRef = useRef(0);
  const isFinishingRef = useRef(false);
  const [audioState, setAudioState] = useState<StartupAudioState>({
    isEnabled: true,
    manuallyToggled: false,
    autoplayFailed: false
  });

  useStartupTheme(theme, desktopApi);

  useEffect(() => {
    if (hoverIntent !== "default" || startupCopy.slogans.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setSloganIndex((current) => (current + 1) % startupCopy.slogans.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [hoverIntent, startupCopy.slogans.length]);

  useLayoutEffect(() => {
    const windowMaterialMode = desktopApi?.appMeta.windowMaterialMode ?? "opaque";
    document.documentElement.dataset.lyraWindowMaterial = windowMaterialMode;
    document.documentElement.dataset.lyraMaterialEnabled =
      windowMaterialMode === "native" ? "true" : "false";
  }, [desktopApi]);

  const finish = useCallback(async (isLocal = false): Promise<void> => {
    if (isFinishingRef.current) {
      return;
    }
    isFinishingRef.current = true;
    setAuthError(null);
    try {
      persistStartupPreferences({
        locale: resolvedLocale,
        localePreference: localeChoice,
        theme
      });
      if (auth?.user !== null && auth?.user !== undefined) {
        const updateProfile = desktopApi?.auth?.updateProfile;
        if (updateProfile === undefined) {
          throw new Error("The Lyra authentication bridge is unavailable.");
        }
        const profile = await updateProfile({
          ...(localIdentity === null ? {} : { displayName: localIdentity.displayName }),
          localePreference: localeChoice,
          themePreference: theme,
          onboardingCompleted: true,
          onboardingVersion: 1
        });
        if (profile.onboardingCompleted !== true) {
          throw new Error("Lyra could not finish saving your onboarding preferences.");
        }
        setAuth((current) => current === null ? current : { ...current, profile });
      }
      if (isLocal) {
        markLocalStartupComplete();
      }
      onReady();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
      setView("theme");
    } finally {
      isFinishingRef.current = false;
    }
  }, [auth?.user, desktopApi?.auth, localeChoice, localIdentity?.displayName, onReady, resolvedLocale, setView, theme]);

  const resolveLanguage = useCallback(async (): Promise<void> => {
    const api = desktopApi;
    if (api === null) {
      setResolvedLocale("en-US");
      setWorkbenchLocale("en-US");
      return;
    }
    setView("loading");
    let installed: readonly InstalledLanguagePack[] = [];
    try {
      installed = await api.languagePacks.listInstalled();
    } catch {
      installed = [];
    }
    let catalog: Awaited<ReturnType<typeof api.languagePacks.listCatalog>> = {
      packs: [],
      status: "unavailable"
    };
    try {
      catalog = await api.languagePacks.listCatalog();
    } catch {
      // English remains the startup fallback when the catalog is offline.
    }
    const result = await resolveStartupLocale({
      requestedLocale: api.appMeta.locale ?? navigator.language,
      installed,
      catalog,
      install: (locale) => api.languagePacks.install(locale)
    });
    setResolvedLocale(result.locale);
    setDownloadedLocale(result.downloadedLocale);
    setStartupLocale(result.locale);
    setWorkbenchLocale(result.locale);
  }, [desktopApi]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await resolveLanguage();
      const [snapshot, identity] = await Promise.all([
        desktopApi?.auth?.getSession() ?? Promise.resolve({
          configured: false,
          user: null,
          profile: null
        }),
        desktopApi?.auth?.getLocalIdentity?.() ?? Promise.resolve({
          displayName: "Lyra",
          registered: false
        })
      ]);
      if (!active) return;
      setLocalIdentity(identity);
      setAuth(snapshot);
      if (snapshot.configured === false) {
        setAuthError(configuredErrorRef.current);
      }
      if (snapshot.user !== null && snapshot.profile?.onboardingCompleted !== true) {
        setAuthIntent("signup");
        if (snapshot.profile?.localePreference !== undefined) {
          setLocaleChoice(snapshot.profile.localePreference);
        }
        setTheme((snapshot.profile?.themePreference as WorkbenchThemeId | undefined) ?? "lyra-system");
        setView("welcome-signup");
        return;
      }
      if (snapshot.user !== null || hasCompletedLocalStartup()) {
        onReady();
        return;
      }
      setView("landing");
    })().catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : String(error));
      setView("landing");
    });
    return () => {
      active = false;
    };
  }, [desktopApi, onReady, resolveLanguage, setView]);

  useEffect(() => {
    const unsubscribe = desktopApi?.auth?.onChanged((snapshot) => {
      setAuth(snapshot);
      if (isFinishingRef.current) {
        return;
      }
      if (snapshot.user === null) {
        if (snapshot.error !== undefined) {
          setAuthError(snapshot.error);
        }
        return;
      }
      if (viewRef.current === "language" || viewRef.current === "theme") {
        return;
      }
      setAuthError(null);
      setView(snapshot.profile?.onboardingCompleted === true ? "welcome-login" : "welcome-signup");
      setTheme((snapshot.profile?.themePreference as WorkbenchThemeId | undefined) ?? "lyra-system");
    });
    return unsubscribe;
  }, [desktopApi]);

  const startLogin = async (intent: "login" | "signup"): Promise<void> => {
    setAuthIntent(intent);
    setAuthError(null);
    setAuthorizationUrl(null);
    setIsAuthUrlCopied(false);
    setView("authenticating");
    try {
      if (desktopApi?.auth === undefined) {
        throw new Error("The Lyra authentication bridge is unavailable.");
      }
      const result = await desktopApi.auth.startGoogleLogin();
      setAuthorizationUrl(result.authorizationUrl);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
      setView("landing");
    }
  };

  const cancelAuth = (): void => {
    setAuthorizationUrl(null);
    setIsAuthUrlHovered(false);
    setIsAuthUrlCopied(false);
    setIsCancelHovered(false);
    setAuthError(null);
    setView("landing");
  };

  const copyAuthorizationUrl = async (): Promise<void> => {
    if (authorizationUrl === null) {
      return;
    }
    if (await writeClipboardText(authorizationUrl)) {
      setIsAuthUrlCopied(true);
      window.setTimeout(() => setIsAuthUrlCopied(false), 1800);
    }
  };

  const localeChoices = useMemo<readonly LocaleChoice[]>(() => {
    const choices: LocaleChoice[] = [
      { id: "system", label: language.followSystem, preference: { mode: "system" } },
      { id: "zh-CN", label: language.chinese, preference: { mode: "explicit", locale: "zh-CN" } },
      { id: "en-US", label: language.english, preference: { mode: "explicit", locale: "en-US" } }
    ];
    if (downloadedLocale !== undefined) {
      choices.push({
        id: downloadedLocale,
        label: downloadedLocale,
        preference: { mode: "explicit", locale: downloadedLocale }
      });
    }
    return choices;
  }, [downloadedLocale, language.chinese, language.english, language.followSystem]);

  const openLegal = (url: string): void => {
    void desktopApi?.openExternal(url);
  };

  const tagline = (() => {
    if (isEasterEggActive) {
      return isChinese(activeLocale) ? EASTER_EGG_COPY.zh : EASTER_EGG_COPY.en;
    }
    switch (hoverIntent) {
      case "terms":
        return startupCopy.terms;
      case "privacy":
        return startupCopy.privacy;
      case "local":
        return startupCopy.local;
      case "login":
        return localIdentity?.registered
          ? translate("startup.hover.loginKnown", {
              name: localIdentity.registeredDisplayName ?? localIdentity.displayName
            })
          : startupCopy.login;
      case "signup":
        return localIdentity?.registered
          ? translate("startup.hover.signupKnown", {
              name: localIdentity.registeredDisplayName ?? localIdentity.displayName
            })
          : startupCopy.signup;
      case "tagline":
        return startupCopy.taglineHover;
      case "audio":
        return audioState.isEnabled
          ? startupCopy.audioPlaying
          : audioState.manuallyToggled
            ? startupCopy.audioMuted
            : startupCopy.audioUnavailable;
      case "logo":
        return startupCopy.logo;
      case "brand":
        return startupCopy.brand;
      default:
        return startupCopy.slogans[sloganIndex] ?? startupCopy.slogans[0] ?? "";
    }
  })();

  const setHover = (intent: StartupHoverIntent): (() => void) => () => {
    if (isEasterEggActive) {
      return;
    }
    setHoverIntent(intent);
  };

  const handleLogoClick = (): void => {
    logoClickCountRef.current += 1;
    if (logoClickCountRef.current < 8) {
      return;
    }
    logoClickCountRef.current = 0;
    setIsEasterEggActive((active) => !active);
    setHoverIntent("default");
    setSloganIndex(0);
  };

  /*
   * The startup page is intentionally self-contained: the same audio control
   * survives the small auth screens while its state remains local to this gate.
   */
  const audioControlProps = {
    onHover: setHover("audio"),
    onLeave: setHover("default"),
    onStateChange: setAudioState
  };

  if (view === "loading") {
    return (
      <StartupFrame {...audioControlProps}>
        <div className="lyra-startup-status lyra-startup-boot-status">
          <div className="lyra-startup-boot-brand">LYRA</div>
          <p className="lyra-agents-shimmer">{language.checking}</p>
        </div>
      </StartupFrame>
    );
  }

  if (view === "authenticating") {
    return (
      <StartupFrame {...audioControlProps}>
        <div className="lyra-startup-status">
          <button
            type="button"
            className="lyra-startup-auth-copy"
            onClick={() => void copyAuthorizationUrl()}
            onMouseEnter={() => setIsAuthUrlHovered(true)}
            onMouseLeave={() => setIsAuthUrlHovered(false)}
            disabled={authorizationUrl === null}
          >
            <span
              key={isCancelHovered ? "cancel" : isAuthUrlCopied ? "copied" : isAuthUrlHovered ? "copy" : "browser"}
              className="lyra-agents-shimmer"
            >
              {isCancelHovered
                ? language.cancelHover
                : isAuthUrlCopied
                  ? language.copiedAuthUrl
                  : isAuthUrlHovered
                    ? language.copyAuthUrl
                    : language.browser}
            </span>
          </button>
          {authError ? <p className="lyra-startup-error">{authError}</p> : null}
          <button
            type="button"
            className="lyra-startup-local lyra-startup-cancel"
            onClick={cancelAuth}
            onMouseEnter={() => setIsCancelHovered(true)}
            onMouseLeave={() => setIsCancelHovered(false)}
          >
            {language.cancel}
          </button>
        </div>
      </StartupFrame>
    );
  }

  if (view === "welcome-signup" || view === "welcome-login") {
    const user = auth?.user;
    if (user === null || user === undefined) {
      return <StartupFrame {...audioControlProps}><div className="lyra-startup-status"><p>{language.authError}</p></div></StartupFrame>;
    }
    return (
      <StartupFrame {...audioControlProps}>
        <div className="lyra-startup-welcome">
          <Avatar user={user} />
          <h1>{view === "welcome-signup" ? language.welcome : language.welcomeBack(userName(user))}</h1>
          <p>{user.email ?? "Google account"}</p>
          {view === "welcome-signup" ? (
            <AppButton variant="default" size="lg" onClick={() => setView("language")}>{language.continue}</AppButton>
          ) : (
            <AppButton variant="default" size="lg" onClick={() => setView("theme")}>{language.continue}</AppButton>
          )}
        </div>
      </StartupFrame>
    );
  }

  if (view === "language") {
    return (
      <StartupFrame {...audioControlProps}>
        <div className="lyra-startup-panel">
          <button className="lyra-startup-back" type="button" onClick={() => setView("welcome-signup")}>
            <span aria-hidden="true">←</span> {language.back}
          </button>
          <StartupPreferenceTitle text={language.chooseLanguage} />
          <div className="lyra-startup-choice-list">
            {localeChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`lyra-startup-choice${JSON.stringify(localeChoice) === JSON.stringify(choice.preference) ? " is-selected" : ""}`}
                onClick={() => {
                  setLocaleChoice(choice.preference);
                  const nextLocale =
                    choice.preference.mode === "explicit"
                      ? choice.preference.locale
                      : resolvedLocale;
                  setStartupLocale(nextLocale);
                  setWorkbenchLocale(nextLocale);
                }}
              >
                <span>{choice.label}</span>
                {JSON.stringify(localeChoice) === JSON.stringify(choice.preference) ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
          <AppButton variant="default" size="lg" onClick={() => setView("theme")}>{language.continue}</AppButton>
        </div>
      </StartupFrame>
    );
  }

  if (view === "theme") {
    return (
      <StartupFrame {...audioControlProps}>
        <div className="lyra-startup-panel">
          <button className="lyra-startup-back" type="button" onClick={() => setView(authIntent === "signup" ? "language" : "welcome-login")}>
            <span aria-hidden="true">←</span> {language.back}
          </button>
          <StartupPreferenceTitle text={language.chooseTheme} />
          <div className="lyra-startup-theme-grid">
            {(["lyra-system", "lyra-dark", "lyra-light"] as const).map((id) => (
              <ThemePreview
                key={id}
                theme={id}
                label={id === "lyra-system" ? language.systemTheme : id === "lyra-dark" ? language.dark : language.light}
                selected={theme === id}
                onSelect={() => setTheme(id)}
              />
            ))}
          </div>
          <AppButton variant="default" size="lg" onClick={() => void finish()}>{language.continue}</AppButton>
          {authError ? <p className="lyra-startup-error">{authError}</p> : null}
        </div>
      </StartupFrame>
    );
  }

  return (
    <StartupFrame {...audioControlProps}>
      <div className="lyra-startup-hero">
        <div
          className="lyra-startup-logo-wrap"
          onMouseEnter={setHover("logo")}
          onMouseLeave={setHover("default")}
          onClick={handleLogoClick}
        >
          <AnimatedAsciiLogo />
        </div>
        <h1
          className="lyra-startup-brand"
          onMouseEnter={setHover("brand")}
          onMouseLeave={setHover("default")}
        >
          LYRA
        </h1>
        <StartupTagline
          text={tagline}
          onHover={setHover("tagline")}
          onLeave={setHover("default")}
        />
        <div className="lyra-startup-actions">
          <AppButton
            variant="default"
            size="lg"
            className="lyra-startup-login-button"
            onClick={() => void startLogin("login")}
            onMouseEnter={setHover("login")}
            onMouseLeave={setHover("default")}
          >
            {localIdentity?.registered ? (
              <span className="lyra-startup-login-avatar" aria-hidden="true">
                <LocalIdentityAvatar identity={localIdentity} />
              </span>
            ) : null}
            {language.login}
          </AppButton>
          <AppButton
            variant="secondary"
            size="lg"
            onClick={() => void startLogin("signup")}
            onMouseEnter={setHover("signup")}
            onMouseLeave={setHover("default")}
          >
            {language.signup}
          </AppButton>
        </div>
        <button
          className="lyra-startup-local"
          type="button"
          onClick={() => {
            void finish(true);
          }}
          onMouseEnter={setHover("local")}
          onMouseLeave={setHover("default")}
        >
          {language.local}
        </button>
        <div className="lyra-startup-legal">
          <button
            type="button"
            onClick={() => openLegal(TERMS_URL)}
            onMouseEnter={setHover("terms")}
            onMouseLeave={setHover("default")}
          >
            {language.terms} ↗
          </button>
          <button
            type="button"
            onClick={() => openLegal(PRIVACY_URL)}
            onMouseEnter={setHover("privacy")}
            onMouseLeave={setHover("default")}
          >
            {language.privacy} ↗
          </button>
        </div>
        {authError ? <p className="lyra-startup-error">{authError || (auth?.configured === false ? language.configured : language.authError)}</p> : null}
      </div>
    </StartupFrame>
  );
};

type StartupFrameProps = {
  readonly children: ReactNode;
  readonly onHover: () => void;
  readonly onLeave: () => void;
  readonly onStateChange: (state: StartupAudioState) => void;
};

const StartupFrame = ({
  children,
  onHover,
  onLeave,
  onStateChange
}: StartupFrameProps) => (
  <main className="lyra-startup-root">
    <StartupAudioControl
      onHover={onHover}
      onLeave={onLeave}
      onStateChange={onStateChange}
    />
    <section className="lyra-startup-surface">{children}</section>
  </main>
);
