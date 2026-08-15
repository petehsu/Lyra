"use client";

import { faApple, faLinux, faWindows } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Check, ChevronDown, Command, Cpu, Download, Smartphone } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SiteCopy } from "@/lib/i18n";
import { detectDesktop, recommendedVariant, variantsFor, type DownloadPlatform, type DownloadVariant } from "@/lib/downloads";

type DownloadSectionProps = { readonly copy: SiteCopy["download"] };
const icons = { macos: faApple, windows: faWindows, linux: faLinux } as const;
const upcomingPlatforms = [Cpu, Smartphone, Command] as const;

export function DownloadSection({ copy }: DownloadSectionProps) {
  const sectionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [detected, setDetected] = useState<Awaited<ReturnType<typeof detectDesktop>>>(null);
  const [detectionDone, setDetectionDone] = useState(false);
  const [openPlatform, setOpenPlatform] = useState<DownloadPlatform | null>(null);
  const [selections, setSelections] = useState<Partial<Record<DownloadPlatform, DownloadVariant>>>({});

  useEffect(() => {
    let active = true;
    void detectDesktop(navigator).then((value) => {
      if (active) { setDetected(value); setDetectionDone(true); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenPlatform(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpenPlatform(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const focusMenuItem = (platform: DownloadPlatform, direction: 1 | -1): void => {
    requestAnimationFrame(() => {
      const items = rootRef.current?.querySelectorAll<HTMLButtonElement>(`[data-download-menu="${platform}"] [role="menuitem"]`);
      if (items === undefined || items.length === 0) return;
      const current = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
      const next = current < 0 ? (direction === 1 ? 0 : items.length - 1) : (current + direction + items.length) % items.length;
      items[next]?.focus();
    });
  };

  return (
    <section id="download" className="download-section drop-reveal">
      <div className="download-inner" ref={rootRef}>
        <header className="download-intro">
          <p className="download-kicker">{copy.kicker}</p><h2>{copy.title}</h2><p>{copy.body}</p>
        </header>
        <div className="download-platforms">
          {copy.platforms.map((platform, index) => {
            const recommended = detectionDone ? recommendedVariant(detected, platform.id) : null;
            const selected = selections[platform.id] ?? recommended;
            const menuId = `${sectionId}-${platform.id}-menu`;
            const isOpen = openPlatform === platform.id;
            return (
              <article className="download-platform" key={platform.id}>
                <header><span>0{index + 1}</span><FontAwesomeIcon icon={icons[platform.id]} aria-hidden="true" /></header>
                <h3>{platform.name}</h3><p>{platform.detail}</p>
                <div className="download-split">
                  {selected === null ? (
                    <button type="button" className="download-main" onClick={() => setOpenPlatform(platform.id)}><span>{copy.select}</span><Download size={17} aria-hidden="true" /></button>
                  ) : (
                    <a className="download-main" href={selected.href} rel="noopener noreferrer"><span><strong>{copy.action}</strong><small>{selected.label}</small></span><Download size={17} aria-hidden="true" /></a>
                  )}
                  <button type="button" className="download-menu-toggle" aria-label={`${platform.name}: ${copy.otherVersions}`} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={menuId} onClick={() => setOpenPlatform(isOpen ? null : platform.id)} onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpenPlatform(platform.id); focusMenuItem(platform.id, event.key === "ArrowDown" ? 1 : -1); }
                  }}><ChevronDown size={18} aria-hidden="true" /></button>
                  {isOpen ? (
                    <div id={menuId} className="download-menu" role="menu" data-download-menu={platform.id} aria-label={copy.otherVersions}>
                      {variantsFor(platform.id).map((variant) => {
                        const isRecommended = recommended?.href === variant.href;
                        const isSelected = selected?.href === variant.href;
                        return <button type="button" role="menuitem" key={variant.href} onClick={() => { setSelections((current) => ({ ...current, [platform.id]: variant })); setOpenPlatform(null); }} onKeyDown={(event) => {
                          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusMenuItem(platform.id, event.key === "ArrowDown" ? 1 : -1); }
                        }}><span>{variant.label}{isRecommended ? <small>{copy.recommended}</small> : null}</span>{isSelected ? <Check size={16} aria-hidden="true" /> : null}</button>;
                      })}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        <div className="download-upcoming"><h3>{copy.upcomingTitle}</h3><ul>{copy.upcoming.map((platform, index) => { const Icon = upcomingPlatforms[index]; return <li key={platform}><Icon size={16} strokeWidth={1.5} aria-hidden="true" /><span>{platform}</span><small>{copy.waiting}</small></li>; })}</ul></div>
      </div>
    </section>
  );
}
