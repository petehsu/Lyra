"use client";

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Cpu, ArrowRight, Layers, ShieldCheck, Terminal, AppWindow } from 'lucide-react';

export default function ArchitectureSection() {
  const t = useTranslations('Architecture');
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const architectureFlow = [
    {
      id: "workbench",
      icon: AppWindow,
      title: "React Workbench (UI)",
      process: "Electron Renderer",
      desc: "Presentation workspace for folder tree, file editor, terminal panels, and the streaming AI assistant interface."
    },
    {
      id: "bridge",
      icon: Layers,
      title: "TS Platform Bridge",
      process: "Electron Main Process",
      desc: "Handles IPC routing, OS notifications, window material states, and forwards calls to the local daemon via runtime-client.ts."
    },
    {
      id: "daemon",
      icon: Cpu,
      title: "lyrad Native Daemon",
      process: "Rust Background Core",
      desc: "Exposes PTY terminal, FTS SQLite databases, OS无障碍 hooks, Tool-FS registry, and high-performance FFI operations."
    }
  ];

  return (
    <section className="py-24 border-b border-border-line bg-gradient-to-b from-[#09090b] to-[#070709] relative overflow-hidden">
      
      {/* Background grids */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.02),transparent_60%)]"></div>

      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-16">
          <span className="text-swiss text-lyra-cyan font-bold tracking-widest block mb-3">// DECENTRALIZED RUNTIME</span>
          <h2 className="font-editorial text-4xl md:text-5xl lg:text-6xl tracking-tight text-text-primary mb-6">
            {t('title')}
          </h2>
          <p className="text-lg text-text-muted font-light leading-relaxed font-sans">
            {t('subtitle')} — {t('desc')}
          </p>
        </div>

        {/* Visual Architectural Map */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center mt-12">
          {architectureFlow.map((node, idx) => {
            const Icon = node.icon;
            const isHovered = hoveredNode === node.id;
            return (
              <div 
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className={`p-8 rounded-[var(--radius-card)] border bg-matte-surface/80 backdrop-blur-sm transition-all duration-300 relative ${
                  isHovered ? 'border-lyra-cyan shadow-[0_0_20px_rgba(6,182,212,0.1)] scale-[1.02]' : 'border-border-line'
                }`}
              >
                {/* Connector arrow for desktop layout */}
                {idx < 2 && (
                  <div className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 z-20 bg-[#09090b] border border-border-line p-1.5 rounded-full text-text-muted hover:text-lyra-cyan transition-colors">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}

                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-lg border transition-colors ${
                    isHovered ? 'bg-lyra-cyan/10 border-lyra-cyan/30 text-lyra-cyan' : 'bg-deep-void border-border-line text-text-muted'
                  }`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-mono font-bold text-text-primary text-sm">{node.title}</h3>
                    <span className="text-[10px] uppercase font-mono text-text-muted/60 tracking-wider">{node.process}</span>
                  </div>
                </div>

                <p className="text-sm font-sans text-text-muted font-light leading-relaxed mb-6">
                  {node.desc}
                </p>

                {/* Technical status badges */}
                <div className="border-t border-border-line/40 pt-4 flex items-center justify-between text-[11px] font-mono select-none">
                  {node.id === "workbench" && (
                    <>
                      <span className="text-text-muted">Type: IPC View</span>
                      <span className="text-emerald-400">React 19</span>
                    </>
                  )}
                  {node.id === "bridge" && (
                    <>
                      <span className="text-text-muted">Type: Bridge API</span>
                      <span className="text-lyra-cyan">TS 5.6</span>
                    </>
                  )}
                  {node.id === "daemon" && (
                    <>
                      <span className="text-text-muted">Type: Native FFI</span>
                      <span className="text-purple-400">Rust 2024</span>
                    </>
                  )}
                </div>

              </div>
            );
          })}
        </div>

        {/* Dynamic FFI Data Stream Simulator */}
        <div className="mt-12 p-6 rounded-[var(--radius-card)] border border-border-line bg-deep-void/40 backdrop-blur-sm font-mono text-xs text-text-muted relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 text-[9px] text-text-muted/50 tracking-wider">LIVE IPC BRIDGE SPECTROGRAM</div>
          
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border-line/40 pb-4 mb-4 select-none">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-text-primary font-bold">Bridge Connection State: Active</span>
            </div>
            <div className="text-text-muted/60 text-[10px]">
              Channel: TCP://127.0.0.1:9000 (lyrad) ── Packet Size: 1.2KB
            </div>
          </div>

          <div className="space-y-1 text-text-muted/80">
            <div><span className="text-emerald-400">→ [IPC SEND]</span> <span className="text-text-primary">{"\"action\": \"run_tool\", \"payload\": { \"path\": \"/tools/terminal/create_pane\", \"args\": {} }"}</span></div>
            <div><span className="text-purple-400">← [DAEMON RECV]</span> <span className="text-text-primary">Binding native PTY channel to thread ID: 0x70000a6e3000</span></div>
            <div><span className="text-purple-400">← [DAEMON EXECUTED]</span> <span className="text-emerald-400">{"\"status\": \"completed\", \"result\": { \"paneId\": \"pane_01\" }"}</span></div>
            <div><span className="text-emerald-400">→ [IPC RECV]</span> <span className="text-text-muted">Dispatching turn result to workbench shell view model</span></div>
          </div>
        </div>

      </div>
    </section>
  );
}
