"use client";

import { useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { FolderGit2, ShieldCheck, Database, Sliders, ArrowRight, EyeOff, KeyRound, AlertTriangle } from 'lucide-react';

export default function FeatureScroll() {
  const t = useTranslations('Features');
  const container = useRef<HTMLDivElement>(null);
  const scrollWrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
  }, []);

  useGSAP(() => {
    const panels = gsap.utils.toArray('.feature-panel');
    
    gsap.to(panels, {
      xPercent: -100 * (panels.length - 1),
      ease: "none",
      scrollTrigger: {
        trigger: container.current,
        pin: true,
        scrub: 1,
        end: () => "+=" + (scrollWrapper.current?.offsetWidth || window.innerWidth)
      }
    });
  }, { scope: container });

  return (
    <section ref={container} className="h-screen w-full overflow-hidden bg-deep-void flex items-center relative border-b border-border-line">
      
      {/* Background Section Title Header */}
      <div className="absolute top-8 left-6 md:left-12 flex items-center gap-4 z-20">
        <span className="text-swiss text-lyra-cyan font-bold tracking-widest">// ENGINEERING SPECIFICATIONS</span>
        <div className="h-[1px] w-24 bg-border-line"></div>
        <span className="text-xs font-mono text-text-muted">{t('section_title')}</span>
      </div>

      <div ref={scrollWrapper} className="flex h-full items-center">
        
        {/* Panel 1: Tool-FS */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 lg:col-span-7 border-r border-border-line/40 p-6 md:p-12 lg:pl-24 flex flex-col justify-center">
            <div className="text-swiss-num text-lyra-cyan/15 mb-4 font-mono select-none">01</div>
            <span className="text-xs font-mono text-lyra-cyan uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5" />
              {t('panel1_summary')}
            </span>
            <h2 className="heading-editorial mb-6 text-text-primary">{t('panel1_title')}</h2>
            <p className="font-sans font-light text-lg text-text-muted max-w-xl leading-relaxed">
              {t('panel1_desc')}
            </p>
          </div>
          
          <div className="hidden lg:flex col-span-5 p-12 items-center justify-center bg-[#0c0c0e]/30">
            {/* Tool-FS Interactive Diagram */}
            <div className="w-full max-w-md rounded-lg border border-border-line bg-matte-surface p-6 font-mono text-xs shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 text-[10px] text-lyra-cyan bg-lyra-cyan/10 border-b border-l border-border-line">VFS MODULE</div>
              
              <div className="text-text-muted mb-4 border-b border-border-line/50 pb-2">
                <span>LLM Meta-Tool Interface (Only 6 Visible)</span>
              </div>
              <ul className="space-y-1.5 text-text-primary mb-6">
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ tool_fs_search(query)</li>
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ tool_fs_list(path)</li>
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ tool_fs_read_doc(handle)</li>
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ tool_fs_inspect(handle)</li>
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ tool_fs_run(handle, args)</li>
                <li className="text-lyra-cyan flex items-center gap-1.5">⚡ lyra_turn_finish(records)</li>
              </ul>
              
              <div className="text-text-muted mb-4 border-b border-border-line/50 pb-2 flex items-center justify-between">
                <span>Decoupled Virtual Path Hierarchy</span>
                <span className="text-[10px] text-amber-500">Secure</span>
              </div>
              <ul className="space-y-1.5 text-text-muted pl-4 border-l border-border-line/50">
                <li className="flex items-center gap-1.5">📁 /tools/filesystem/</li>
                <li className="flex items-center gap-1.5 text-text-primary pl-4">📄 write_file <span className="text-[9px] px-1 bg-red-500/20 text-red-400">Policy: Ask</span></li>
                <li className="flex items-center gap-1.5">📁 /tools/browser/</li>
                <li className="flex items-center gap-1.5 text-text-primary pl-4">📄 click_element <span className="text-[9px] px-1 bg-green-500/20 text-green-400">Policy: Auto</span></li>
                <li className="flex items-center gap-1.5">📁 /tools/shell/</li>
                <li className="flex items-center gap-1.5 text-text-primary pl-4">📄 execute <span className="text-[9px] px-1 bg-red-500/20 text-red-400">Policy: Prompt</span></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Panel 2: Semantic Control */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 lg:col-span-7 border-r border-border-line/40 p-6 md:p-12 lg:pl-24 flex flex-col justify-center">
            <div className="text-swiss-num text-ai-amethyst/15 mb-4 font-mono select-none">02</div>
            <span className="text-xs font-mono text-ai-amethyst uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              {t('panel2_summary')}
            </span>
            <h2 className="heading-editorial mb-6 text-text-primary">{t('panel2_title')}</h2>
            <p className="font-sans font-light text-lg text-text-muted max-w-xl leading-relaxed">
              {t('panel2_desc')}
            </p>
          </div>
          
          <div className="hidden lg:flex col-span-5 p-12 items-center justify-center bg-[#0c0c0e]/30">
            {/* Accessibility Tree Mock */}
            <div className="w-full max-w-md rounded-lg border border-border-line bg-matte-surface p-6 font-mono text-xs shadow-lg relative">
              <div className="absolute top-0 right-0 p-3 text-[10px] text-ai-amethyst bg-ai-amethyst/10 border-b border-l border-border-line">OS AX TREE</div>
              
              <div className="text-text-muted mb-4 border-b border-border-line/50 pb-2">
                <span>Platform Accessibility Hook (No Screen coordinate)</span>
              </div>
              
              <div className="space-y-3">
                <div className="border border-border-line/60 p-2.5 rounded bg-deep-void/50">
                  <div className="text-text-primary flex items-center justify-between">
                    <span>Window: "VS Code"</span>
                    <span className="text-[10px] text-text-muted">darwin_ax</span>
                  </div>
                </div>

                <div className="border border-border-line/60 p-2.5 rounded bg-deep-void/50 ml-4">
                  <div className="text-text-primary flex items-center justify-between">
                    <span>Table: "WorkspaceExplorer"</span>
                    <span className="text-[10px] text-text-muted">role: outline</span>
                  </div>
                </div>

                <div className="border-2 border-ai-amethyst/60 p-2.5 rounded bg-ai-amethyst/5 ml-8 relative">
                  <div className="absolute -top-2 -left-2 w-3 h-3 rounded-full bg-ai-amethyst animate-ping"></div>
                  <div className="text-ai-amethyst flex items-center justify-between font-bold">
                    <span>Button: "git_commit"</span>
                    <span className="text-[9px] px-1 bg-ai-amethyst/20 rounded">Focused</span>
                  </div>
                  <div className="text-[10px] text-text-muted mt-1.5 pl-2 border-l border-ai-amethyst/30">
                    <div>Action: press()</div>
                    <div>StableHandle: osRef(id: ax_2384a)</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-[11px] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Background Execution Secure. Focus undisturbed.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel 3: Memory Engine */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 lg:col-span-7 border-r border-border-line/40 p-6 md:p-12 lg:pl-24 flex flex-col justify-center">
            <div className="text-swiss-num text-lyra-cyan/15 mb-4 font-mono select-none">03</div>
            <span className="text-xs font-mono text-lyra-cyan uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              {t('panel3_summary')}
            </span>
            <h2 className="heading-editorial mb-6 text-text-primary">{t('panel3_title')}</h2>
            <p className="font-sans font-light text-lg text-text-muted max-w-xl leading-relaxed">
              {t('panel3_desc')}
            </p>
          </div>
          
          <div className="hidden lg:flex col-span-5 p-12 items-center justify-center bg-[#0c0c0e]/30">
            {/* Version control memory mock */}
            <div className="w-full max-w-md rounded-lg border border-border-line bg-matte-surface p-6 font-mono text-xs shadow-lg relative">
              <div className="absolute top-0 right-0 p-3 text-[10px] text-lyra-cyan bg-lyra-cyan/10 border-b border-l border-border-line">SQLITE CORE</div>
              
              <div className="text-text-muted mb-3 border-b border-border-line/50 pb-2">
                <span>CAS Version Conflict Checker</span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between p-2 bg-[#121214] border border-border-line rounded">
                  <span>Local Memory Status</span>
                  <span className="text-text-primary">revision: 5 (shared)</span>
                </div>
                <div className="flex justify-between p-2 bg-[#121214] border border-border-line rounded">
                  <span>Incoming Remote Mutation</span>
                  <span className="text-amber-400">revision: 5 (device: ipad)</span>
                </div>
                
                <div className="border border-red-500/20 bg-red-500/5 p-3 rounded text-[11px] text-red-400 mt-2">
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Sync Conflict Detected</span>
                  </div>
                  <span>Local modifications took precedence. remote mutation rejected automatically.</span>
                </div>

                <div className="border border-border-line/50 p-2.5 rounded bg-deep-void/40 mt-2">
                  <div className="text-text-muted text-[10px] mb-1">Overlay Memory Layers:</div>
                  <div className="flex items-center justify-between text-[11px] text-text-primary">
                    <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">FROZEN</span>
                    <span className="text-text-muted">➔</span>
                    <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">SHARED</span>
                    <span className="text-text-muted">➔</span>
                    <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">CUT</span>
                    <span className="text-text-muted">➔</span>
                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded">LIVE</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel 4: Health Guard */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 lg:col-span-7 border-r border-border-line/40 p-6 md:p-12 lg:pl-24 flex flex-col justify-center">
            <div className="text-swiss-num text-ai-amethyst/15 mb-4 font-mono select-none">04</div>
            <span className="text-xs font-mono text-ai-amethyst uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              {t('panel4_summary')}
            </span>
            <h2 className="heading-editorial mb-6 text-text-primary">{t('panel4_title')}</h2>
            <p className="font-sans font-light text-lg text-text-muted max-w-xl leading-relaxed">
              {t('panel4_desc')}
            </p>
          </div>
          
          <div className="hidden lg:flex col-span-5 p-12 items-center justify-center bg-[#0c0c0e]/30">
            {/* Linter Radar Mock */}
            <div className="w-full max-w-md rounded-lg border border-border-line bg-matte-surface p-6 font-mono text-xs shadow-lg relative">
              <div className="absolute top-0 right-0 p-3 text-[10px] text-ai-amethyst bg-ai-amethyst/10 border-b border-l border-border-line">CI BUDGET</div>
              
              <div className="text-text-muted mb-4 border-b border-border-line/50 pb-2">
                <span>verify-architecture-health.ts (Ratchet Linter)</span>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-deep-void/60 border border-border-line rounded flex items-center justify-between">
                  <div>
                    <div className="font-bold text-text-primary">apps/desktop/src/main/index.ts</div>
                    <div className="text-text-muted text-[10px] mt-1">Existing composition root budget</div>
                  </div>
                  <div className="text-right">
                    <span className="text-emerald-400 font-bold font-mono">924 / 950 LOC</span>
                    <div className="text-[9px] text-emerald-400 bg-emerald-400/10 px-1 py-0.2 rounded mt-1 text-center">PASSED</div>
                  </div>
                </div>

                <div className="p-3 bg-deep-void/60 border border-red-500/20 rounded flex items-center justify-between relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>
                  <div>
                    <div className="font-bold text-text-primary">crates/lyra-agent-runtime/web.rs</div>
                    <div className="text-text-muted text-[10px] mt-1">Web native tool module budget</div>
                  </div>
                  <div className="text-right">
                    <span className="text-red-400 font-bold font-mono">1845 / 1840 LOC</span>
                    <div className="text-[9px] text-red-400 bg-red-400/10 px-1 py-0.2 rounded mt-1 text-center font-bold">BUDGET EXCEEDED</div>
                  </div>
                </div>

                <div className="border border-border-line/50 p-2.5 rounded bg-deep-void/40 text-[10px] text-text-muted leading-relaxed">
                  <span className="font-bold text-text-primary block mb-1">Ratchet rule:</span>
                  New features cannot raise the budget of baseline debt. Modules must be split and responsibilities extracted to pass compilation.
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
