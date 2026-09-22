import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from "react";
import { Volume2, VolumeX } from "@lyra/icons";
import {
  normalizeUiFontSizePx,
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars as resolveThemeVariables,
  resolveWorkbenchThemeId,
  type WorkbenchThemeId
} from "@workbench/theme";
import {
  getDesktopApi,
  syncCssVarsToDocumentRoot,
  syncDocumentThemeTone,
  syncWindowThemeSource
} from "@workbench/shell/service";
import { LYRA_ASCII_LOGO } from "@workbench/ai-panel/lyra-agents/features/chat/ascii-logo";
import startupAudioUrl from "../assets/audio/mountain-moon-mission.mp3";
import { readStoredUiFontSizePx } from "./startup-preferences";

export type StartupAudioState = {
  readonly isEnabled: boolean;
  readonly manuallyToggled: boolean;
  readonly autoplayFailed: boolean;
};

export const AnimatedAsciiLogo = () => (
  <pre className="lyra-startup-ascii-logo" aria-label="Lyra" role="img">
    {LYRA_ASCII_LOGO}
  </pre>
);

export const AnimatedStartupCopy = ({
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

export const StartupTagline = ({
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

export const useStartupTheme = (
  theme: WorkbenchThemeId,
  desktopApi: ReturnType<typeof getDesktopApi>
): void => {
  const [prefersDark, setPrefersDark] = useState(readSystemPrefersDark);
  useEffect(() => observeSystemPrefersDark(setPrefersDark), []);
  useLayoutEffect(() => {
    const vars = resolveThemeVariables(theme, prefersDark);
    const resolvedTheme = resolveWorkbenchThemeId(theme, prefersDark);
    syncCssVarsToDocumentRoot({
      ...vars,
      "--lyra-ui-font-size": `${normalizeUiFontSizePx(readStoredUiFontSizePx())}px`
    });
    syncDocumentThemeTone(resolvedTheme);
    syncWindowThemeSource(desktopApi, theme);
  }, [desktopApi, prefersDark, theme]);
};

export const StartupFrame = ({
  children,
  mode = "startup",
  onHover,
  onLeave,
  onStateChange
}: {
  readonly children: ReactNode;
  readonly mode?: "startup" | "installer" | "uninstaller";
  readonly onHover?: () => void;
  readonly onLeave?: () => void;
  readonly onStateChange?: (state: StartupAudioState) => void;
}) => (
  <main className={mode === "startup" ? "lyra-startup-root" : `lyra-startup-root lyra-${mode}-shell`}>
    {mode === "startup" && onHover !== undefined && onLeave !== undefined && onStateChange !== undefined ? (
      <StartupAudioControl
        onHover={onHover}
        onLeave={onLeave}
        onStateChange={onStateChange}
      />
    ) : null}
    <section className={mode === "installer" ? "lyra-startup-surface lyra-installer-surface" : "lyra-startup-surface"}>
      {children}
    </section>
  </main>
);
