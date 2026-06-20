"use client";

import { useTranslations } from 'next-intl';
import { useRef, useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Terminal, Cpu, HardDrive, ShieldCheck, Download, CodeXml } from 'lucide-react';

export default function HeroSection() {
  const t = useTranslations('Hero');
  const navT = useTranslations('Navigation');
  const container = useRef<HTMLDivElement>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'editor' | 'timeline'>('editor');

  const RUST_CODE_MOCK = `// Lyra Native-Core Bootstrap
pub fn init_runtime() -> Result<(), CoreError> {
    let root = runtime_root()?;
    ensure_memory_store(&root)?;
    
    // Initialize Tool-FS Virtual Registry
    let mut registry = ToolFsRegistry::new();
    registry.register_core_builtins()?;
    
    // Bind Accessibility Platform Adapters
    #[cfg(target_os = "macos")]
    registry.bind_adapter(mac::AccessibilityAdapter::new());
    
    info!("Lyra agent kernel initialized successfully.");
    Ok(())
}`;

  const AGENT_TIMELINE_MOCK = [
    { time: "22:01:05", type: "system", text: "Initializing session_runtime [ID: s_98ac41]" },
    { time: "22:01:06", type: "agent", text: "Agent activated. Analyzing project workspace..." },
    { time: "22:01:07", type: "tool-call", text: "inspect /tools/filesystem/list_dir" },
    { time: "22:01:07", type: "tool-res", text: "Status: 200 OK. 12 files detected." },
    { time: "22:01:09", type: "agent", text: "Checking memory context for similar projects..." },
    { time: "22:01:10", type: "memory", text: "Recall Match: [project_preference] use_edition_2024 (score: 0.94)" },
    { time: "22:01:12", type: "tool-call", text: "run /tools/shell/execute { command: 'cargo check' }" },
    { time: "22:01:14", type: "tool-res", text: "Output: 0 errors, 1 warning (unused import)" },
    { time: "22:01:15", type: "system", text: "lyra_turn_finish { verificationRecords: [passed] }" },
  ];

  useGSAP(() => {
    const tl = gsap.timeline();
    
    tl.fromTo('.mask-inner', 
      { y: '100%' },
      { y: '0%', duration: 1.2, stagger: 0.12, ease: 'power3.out' }
    );
    
    tl.from('.fade-in-element', {
      opacity: 0,
      y: 30,
      duration: 1.2,
      stagger: 0.15,
      ease: 'power2.out',
    }, "-=0.8");
  }, { scope: container });

  // Stream logs into the terminal mock
  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < AGENT_TIMELINE_MOCK.length) {
        const item = AGENT_TIMELINE_MOCK[index];
        const logLine = `[${item.time}] [${item.type.toUpperCase()}] ${item.text}`;
        setTerminalLogs(prev => [...prev, logLine]);
        index++;
      } else {
        clearInterval(interval);
        // Reset after a pause to loop
        setTimeout(() => {
          setTerminalLogs([]);
          index = 0;
        }, 8000);
      }
    }, 2200);

    return () => clearInterval(interval);
  }, []);

  return (
    <section 
      ref={container} 
      className="relative min-h-screen pt-24 flex flex-col border-b border-border-line overflow-hidden"
    >
      <div className="site-grid flex-1 max-w-7xl mx-auto w-full">
        
        {/* Left Column (Content) */}
        <div className="col-span-12 lg:col-span-5 border-r border-border-line/40 p-6 md:p-12 flex flex-col justify-center">
          <div className="mb-6 fade-in-element">
            <span className="text-swiss text-lyra-cyan bg-lyra-cyan/10 px-3 py-1 rounded-full border border-lyra-cyan/20">
              {t('status_bar')}
            </span>
          </div>
          
          <h1 className="flex flex-col mb-8">
            <div className="mask-reveal">
              <span className="mask-inner block font-editorial text-5xl md:text-7xl lg:text-8xl tracking-tight text-text-primary">
                Agent-Native
              </span>
            </div>
            <div className="mask-reveal">
              <span className="mask-inner block font-sans font-black text-4xl md:text-6xl lg:text-7xl uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-lyra-cyan to-ai-amethyst text-glow">
                Terminal
              </span>
            </div>
            <div className="mask-reveal">
              <span className="mask-inner block font-editorial text-4xl md:text-6xl lg:text-7xl italic text-text-muted">
                Environment.
              </span>
            </div>
          </h1>
          
          <p className="fade-in-element text-lg md:text-xl text-text-muted mb-10 leading-relaxed font-sans font-light">
            {t('subtitle')}
          </p>
          
          <div className="fade-in-element flex flex-col sm:flex-row gap-4">
            <button className="px-8 py-4 bg-lyra-cyan hover:bg-lyra-cyan/90 text-deep-void font-sans font-medium rounded-[var(--radius-button)] transition-all hover:scale-[1.02] flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <Download className="w-5 h-5" />
              {t('cta_primary')}
            </button>
            <button className="px-8 py-4 bg-transparent hover:bg-white/5 text-text-primary font-sans font-medium rounded-[var(--radius-button)] border border-border-line transition-all flex items-center justify-center gap-2">
              <CodeXml className="w-5 h-5" />
              {t('cta_secondary')}
            </button>
          </div>

          <div className="fade-in-element mt-16 grid grid-cols-3 gap-6 pt-8 border-t border-border-line/40">
            <div>
              <div className="text-xl md:text-2xl font-mono text-text-primary font-bold">120ms</div>
              <div className="text-xs text-text-muted uppercase tracking-wider mt-1">AX Latency</div>
            </div>
            <div>
              <div className="text-xl md:text-2xl font-mono text-text-primary font-bold">VFS</div>
              <div className="text-xs text-text-muted uppercase tracking-wider mt-1">Tool-FS Box</div>
            </div>
            <div>
              <div className="text-xl md:text-2xl font-mono text-text-primary font-bold">Rust</div>
              <div className="text-xs text-text-muted uppercase tracking-wider mt-1">Daemon-Back</div>
            </div>
          </div>
        </div>

        {/* Right Column (Workbench Mockup) */}
        <div className="col-span-12 lg:col-span-7 p-6 md:p-12 flex items-center justify-center relative bg-gradient-to-br from-deep-void to-matte-surface/40">
          
          {/* Subtle Accent Glow behind mockup */}
          <div className="absolute w-72 h-72 rounded-full bg-lyra-cyan/5 blur-3xl -top-10 -right-10 pointer-events-none"></div>
          <div className="absolute w-80 h-80 rounded-full bg-ai-amethyst/5 blur-3xl -bottom-10 -left-10 pointer-events-none"></div>

          {/* Workbench Frame */}
          <div className="fade-in-element w-full max-w-3xl rounded-[var(--radius-card)] border border-border-line bg-matte-surface overflow-hidden glow-cyan transition-all duration-500">
            
            {/* Header bar */}
            <div className="bg-[#101012] px-4 py-3 flex items-center justify-between border-b border-border-line">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                <span className="text-xs font-mono text-text-muted ml-4 select-none">Lyra Workbench - v0.2.4</span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono text-text-muted">
                <span className="flex items-center gap-1"><Cpu className="w-3 h-3 text-lyra-cyan" /> 84% idle</span>
                <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> local_sync</span>
              </div>
            </div>

            {/* Editor Workspace */}
            <div className="h-[420px] flex">
              
              {/* Sidebar file tree */}
              <div className="w-40 bg-[#121214] border-r border-border-line/60 p-4 flex flex-col justify-between hidden sm:flex select-none">
                <div>
                  <div className="text-[10px] uppercase text-text-muted font-bold tracking-widest mb-3">Workspace</div>
                  <ul className="space-y-2 text-xs font-mono text-text-muted">
                    <li className="flex items-center gap-1.5 text-text-primary"><span className="text-yellow-500">📁</span> crates</li>
                    <li className="flex items-center gap-1.5 text-text-primary"><span className="text-lyra-cyan">📁</span> apps/desktop</li>
                    <li className="flex items-center gap-1.5 pl-3"><span className="text-text-muted">📁</span> src</li>
                    <li className="flex items-center gap-1.5 pl-6 text-lyra-cyan bg-lyra-cyan/5 border-l-2 border-lyra-cyan py-0.5"><span className="text-blue-400">📄</span> main.rs</li>
                    <li className="flex items-center gap-1.5 text-text-primary"><span className="text-blue-400">📄</span> Cargo.toml</li>
                    <li className="flex items-center gap-1.5 text-text-primary"><span className="text-purple-400">📄</span> memory.sqlite</li>
                  </ul>
                </div>
                <div className="text-[10px] font-mono text-text-muted/60 border-t border-border-line/40 pt-2">
                  lyrad: ONLINE
                </div>
              </div>

              {/* Editor Workspace Body */}
              <div className="flex-1 flex flex-col bg-[#141416]">
                
                {/* Tabs */}
                <div className="bg-[#121214] border-b border-border-line/60 flex text-xs font-mono select-none">
                  <button 
                    onClick={() => setActiveTab('editor')}
                    className={`px-4 py-2 border-r border-border-line/60 transition-colors ${activeTab === 'editor' ? 'bg-[#141416] text-lyra-cyan border-t-2 border-t-lyra-cyan' : 'text-text-muted hover:bg-white/5'}`}
                  >
                    main.rs
                  </button>
                  <button 
                    onClick={() => setActiveTab('timeline')}
                    className={`px-4 py-2 border-r border-border-line/60 transition-colors ${activeTab === 'timeline' ? 'bg-[#141416] text-ai-amethyst border-t-2 border-t-ai-amethyst' : 'text-text-muted hover:bg-white/5'}`}
                  >
                    agent_timeline
                  </button>
                </div>

                {/* Editor Content Area */}
                <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-text-muted leading-relaxed">
                  
                  {activeTab === 'editor' ? (
                    <pre className="text-emerald-400/90 whitespace-pre-wrap select-all selection:bg-white/20">
                      {RUST_CODE_MOCK}
                    </pre>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] border-b border-border-line/40 pb-2 mb-2">
                        <span>active_session: s_98ac41</span>
                        <span className="text-lyra-cyan">STATUS: EXECUTING</span>
                      </div>
                      {AGENT_TIMELINE_MOCK.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                          <span className="text-text-muted/50 text-[10px] pt-0.5 select-none">{item.time}</span>
                          <span className={`px-1.5 py-0.2 rounded-[3px] text-[9px] font-bold uppercase select-none ${
                            item.type === 'system' ? 'bg-white/10 text-text-primary' :
                            item.type === 'agent' ? 'bg-lyra-cyan/20 text-lyra-cyan' :
                            item.type === 'tool-call' ? 'bg-amber-500/20 text-amber-500' :
                            item.type === 'tool-res' ? 'bg-emerald-500/20 text-emerald-500' :
                            'bg-purple-500/20 text-purple-400'
                          }`}>{item.type}</span>
                          <span className="text-text-primary/90">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                </div>

                {/* Simulated Terminal Section */}
                <div className="h-40 border-t border-border-line/80 bg-[#0d0d0f] p-4 font-mono text-[11px] overflow-y-auto flex flex-col justify-end">
                  <div className="space-y-1">
                    {terminalLogs.map((log, idx) => {
                      let color = "text-text-muted";
                      if (log.includes("SYSTEM")) color = "text-text-muted/60";
                      else if (log.includes("AGENT")) color = "text-lyra-cyan";
                      else if (log.includes("TOOL-CALL")) color = "text-amber-400";
                      else if (log.includes("TOOL-RES")) color = "text-emerald-400";
                      else if (log.includes("MEMORY")) color = "text-purple-400";
                      return (
                        <div key={idx} className={`${color}`}>
                          {log}
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-1 text-lyra-cyan">
                      <span>$ lyrad --listen-port 9000</span>
                      <span className="w-1.5 h-3.5 bg-lyra-cyan cli-cursor"></span>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
