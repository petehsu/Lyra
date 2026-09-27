"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { RotateCcw, Volume2, VolumeX } from "@lyra/icons";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { FILM_DURATION, FILM_OUTRO } from "@/lib/film-timeline";
import { advanceFilmClock } from "@/lib/film-clock";
import { FilmAgentCursor } from "./film-agent-cursor";
import { createFilmOutro } from "@/lib/film-outro";

gsap.registerPlugin(useGSAP);
type Props = { copy: SiteCopy["video"]; locale: SiteLocale; theme: SiteTheme | null };

export function VideoSection({ copy, locale, theme }: Props) {
  const root = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const position = useRef(0);
  const visible = useRef(false);
  const prepared = useRef(false);
  const outroStarted = useRef(false);
  const finished = useRef(false);
  const sound = useRef(false);
  const failed = useRef(false);
  const playback = useRef({ resume: () => {}, suspend: () => {}, reset: () => {} });
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [outro, setOutro] = useState(false);
  const [ended, setEnded] = useState(false);
  const [audible, setAudible] = useState(false);
  const [error, setError] = useState(false);
  const [scene, setScene] = useState({ locale, theme: theme ?? "light", start: 0, revision: 0 });
  const zh = locale === "zh";

  const silence = () => {
    sound.current = false;
    if (audio.current) { audio.current.muted = true; audio.current.pause(); }
    setAudible(false);
  };
  const syncSound = () => {
    const media = audio.current;
    if (!media || !sound.current || !visible.current || document.hidden || failed.current || finished.current) return;
    if (!prepared.current && position.current < FILM_OUTRO) return;
    media.currentTime = position.current;
    media.muted = false;
    void media.play().catch(error => { if (error?.name !== "AbortError") silence(); });
  };

  const replay = () => {
    playback.current.suspend();
    position.current = 0;
    if (audio.current) audio.current.currentTime = 0;
    prepared.current = false;
    outroStarted.current = false;
    finished.current = false;
    failed.current = false;
    setEnded(false);
    setOutro(false);
    setReady(false);
    setError(false);
    playback.current.reset();
    setScene(current => ({ ...current, start: 0, revision: current.revision + 1 }));
  };
  const toggleSound = () => {
    if (sound.current) silence();
    else {
      sound.current = true;
      setAudible(true);
      // Unlock audio in this gesture at the current visual position.
      // Silent autoplay never depends on permission to play audio.
      syncSound();
    }
  };

  useGSAP(() => {
    const scope = root.current!;
    const stage = scope.querySelector<HTMLElement>(".film-stage")!;
    const tl = createFilmOutro(scope);

    let previous = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      if (failed.current || (!prepared.current && position.current < FILM_OUTRO)) return;
      const media = audio.current;
      const audioTime = sound.current && media && !media.paused ? media.currentTime : null;
      const next = advanceFilmClock(position.current, delta, audioTime);
      position.current = next.time;
      tl.time(position.current);
      stage.dataset.filmTime = position.current.toFixed(2);
      if (position.current >= FILM_OUTRO && !outroStarted.current) {
        outroStarted.current = true;
        setOutro(true);
      } else if (prepared.current && position.current < FILM_OUTRO) {
        frame.current?.contentWindow?.postMessage({ type: "lyra-film-tick", time: position.current }, location.origin);
      }
      if (next.ended) {
        finished.current = true;
        setEnded(true);
        suspend();
      }
    };
    const suspend = () => { gsap.ticker.remove(tick); audio.current?.pause(); };
    const resume = () => {
      if (!visible.current || document.hidden || finished.current) return;
      previous = performance.now();
      gsap.ticker.add(tick);
      syncSound();
    };
    const reset = () => { tl.time(0); stage.dataset.filmTime = "0"; };
    playback.current = { resume, suspend, reset };
    return () => { suspend(); playback.current = { resume: () => {}, suspend: () => {}, reset: () => {} }; };
  }, { scope: root });

  useEffect(() => {
    const stage = root.current!.querySelector<HTMLElement>(".film-stage")!;
    const size = new ResizeObserver(entries => {
      stage.style.setProperty("--film-scale", String(entries[0].contentRect.width / 1920));
    });
    size.observe(stage);
    const preload = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { setLoaded(true); preload.disconnect(); }
    }, { rootMargin: "1800px" });
    preload.observe(stage);
    // Prepare off-screen once the main renderer is measured. The film clock
    // remains paused until visible; only one film renderer is ever mounted.
    let idle: number | undefined;
    let warmTimer: number | undefined;
    const warm = () => {
      if (idle !== undefined || warmTimer !== undefined) return;
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(() => setLoaded(true), { timeout: 1200 });
      } else {
        warmTimer = window.setTimeout(() => setLoaded(true), 250);
      }
    };
    const desktop = document.querySelector<HTMLElement>(".real-workbench-frame");
    if (desktop?.dataset.workspaceMeasured === "true") warm();
    window.addEventListener("lyra:workbench-geometry", warm, { once: true });
    const visibility = new IntersectionObserver(entries => {
      visible.current = entries[0].isIntersecting;
      if (visible.current) playback.current.resume();
      else playback.current.suspend();
    });
    visibility.observe(stage);
    const hidden = () => document.hidden ? playback.current.suspend() : playback.current.resume();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      size.disconnect(); preload.disconnect(); visibility.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("lyra:workbench-geometry", warm);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (warmTimer !== undefined) window.clearTimeout(warmTimer);
    };
  }, []);

  useEffect(() => {
    if (scene.locale === locale && scene.theme === (theme ?? "light")) return;
    if (outroStarted.current) {
      setScene(current => ({ ...current, locale, theme: theme ?? "light" }));
      return;
    }
    audio.current?.pause();
    prepared.current = false;
    setReady(false);
    setScene(current => ({ locale, theme: theme ?? "light", start: position.current, revision: current.revision + 1 }));
  }, [locale, theme, scene.locale, scene.theme]);

  useEffect(() => {
    if (!loaded || outro) return;
    const fail = () => {
      failed.current = true;
      prepared.current = false;
      playback.current.suspend();
      setError(true);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      if (event.data?.type === "lyra-film-ready") {
        clearTimeout(timeout);
        prepared.current = true;
        failed.current = false;
        setReady(true);
        setError(false);
        playback.current.resume();
      } else if (event.data?.type === "lyra-film-error") { clearTimeout(timeout); fail(); }
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(fail, 30000);
    return () => { window.removeEventListener("message", onMessage); clearTimeout(timeout); };
  }, [loaded, scene, outro]);

  return <section id="video" className="video-section" ref={root}>
    {loaded && !outro && <FilmAgentCursor frame={frame} revision={scene.revision} />}
    <div className="video-inner">
      <div className="video-intro"><h2>{copy.title}</h2></div>
      <figure className="video-frame film-player" aria-label={zh ? "Lyra 交互演示" : "Lyra interactive demo"}>
        <div className="film-stage" data-ready={ready} data-phase={ended ? "ended" : outro ? "outro" : "demo"}>
          <div className="film-glass" aria-hidden="true" />
          {loaded && !ended && <iframe ref={frame} key={scene.revision}
            src={`/workbench-preview/index.html?film=1&locale=${scene.locale === "zh" ? "zh-CN" : "en-US"}&theme=${scene.theme}&start=${scene.start}`}
            title={zh ? "Lyra 演示，可展开工具记录" : "Lyra demo, expandable tool activity"}
            inert={!ready || outro} />}
          <div className="film-outro" aria-hidden="true">
            <div className="film-outro-background" />
            <img className="film-outro-mark" src={theme === "dark" ? "/lyra-mark-white.svg" : "/lyra-mark.svg"} alt="" />
            <span className="film-outro-words" />
            <span className="film-outro-name">Lyra</span>
          </div>
          {error && <button className="film-retry" onClick={() => {
            failed.current = false; setError(false); setReady(false);
            setScene(current => ({ ...current, start: position.current, revision: current.revision + 1 }));
          }}>{zh ? "演示加载失败，点击重试" : "Could not load demo. Retry"}</button>}
        </div>
        <button className="film-sound" onClick={ended ? replay : toggleSound} disabled={!ready && !outro}
          aria-label={ended ? (zh ? "重新播放" : "Replay") : zh ? (audible ? "关闭声音" : "开启声音") : (audible ? "Mute" : "Enable sound")}
          aria-pressed={ended ? undefined : audible}>
          {ended ? <RotateCcw size={18} /> : audible ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <audio ref={audio} src={loaded ? "/film-audio.m4a" : undefined} preload={loaded ? "auto" : "none"}
          onEnded={() => { position.current = FILM_DURATION; }} onError={silence} />
      </figure>
    </div>
  </section>;
}
