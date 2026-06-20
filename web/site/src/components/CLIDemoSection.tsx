"use client";

import { useTranslations } from 'next-intl';
import { useState, useRef, useEffect } from 'react';
import { Terminal, Shield, ArrowRight } from 'lucide-react';

export default function CLIDemoSection() {
  const t = useTranslations('CLIDemo');
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([
    "// Welcome to Lyra Tool-FS Simulation console.",
    "// Exposes dynamic API resolution over virtual paths.",
    "Type 'help' or '/tools/list' to begin.",
    ""
  ]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputValue.trim();
    if (!cmd) return;

    let response: string[] = [];
    if (cmd === 'help') {
      response = [
        "Available simulation commands:",
        "  /tools/list                   - List registered virtual domain tool folders",
        "  /tools/inspect <tool_path>    - Get JSON schema for specific tool",
        "  /tools/run <tool_path> <args> - Execute tool over standard envelope",
        "  clear                         - Clear terminal screen"
      ];
    } else if (cmd === '/tools/list') {
      response = [
        "Resolving /tools/ roots...",
        "├── /tools/filesystem",
        "│   ├── list_dir",
        "│   ├── read_file",
        "│   └── write_file",
        "├── /tools/browser",
        "│   ├── click_element",
        "│   └── navigate_url",
        "└── /tools/terminal",
        "    ├── create_pane",
        "    └── execute_command"
      ];
    } else if (cmd.startsWith('/tools/inspect')) {
      const parts = cmd.split(' ');
      const tool = parts[1] || '';
      if (!tool) {
        response = ["Error: Tool path is required. Usage: /tools/inspect <tool_path>"];
      } else {
        response = [
          `Inspecting tool: ${tool}`,
          "Envelope Schema Reference:",
          "  {",
          "    \"path\": \"" + tool + "\",",
          "    \"riskLevel\": \"MEDIUM\",",
          "    \"permissionPolicy\": \"ASK_ONCE\",",
          "    \"inputSchema\": { \"type\": \"object\", \"properties\": { ... } }",
          "  }"
        ];
      }
    } else if (cmd.startsWith('/tools/run')) {
      const parts = cmd.split(' ');
      const tool = parts[1] || '';
      if (!tool) {
        response = ["Error: Tool path is required. Usage: /tools/run <tool_path>"];
      } else {
        response = [
          `[envelope] Dispatching run request for: ${tool}`,
          "[envelope] Checking permissions: mode=ask",
          "✔ Permission granted. Executing native FFI adapter...",
          "Status: 200 OK. Output written to local logs.",
          "Result envelope: { success: true, data: { ... } }"
        ];
      }
    } else if (cmd === 'clear') {
      setHistory([]);
      setInputValue('');
      return;
    } else {
      response = [
        `Command not found: '${cmd}'.`,
        "Type 'help' for available simulation paths."
      ];
    }

    setHistory(prev => [...prev, `$ ${cmd}`, ...response, ""]);
    setInputValue('');
  };

  return (
    <section className="py-24 border-b border-border-line relative bg-matte-surface/20">
      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-16 mx-auto text-center">
          <span className="text-swiss text-lyra-cyan font-bold tracking-widest block mb-3">// INTERACTIVE COMMAND SANDBOX</span>
          <h2 className="font-editorial text-4xl md:text-5xl lg:text-6xl tracking-tight text-text-primary mb-6">
            {t('title')}
          </h2>
          <p className="text-lg text-text-muted font-light leading-relaxed font-sans">
            {t('subtitle')}
          </p>
        </div>

        {/* Terminal Sandbox Box */}
        <div className="max-w-4xl mx-auto rounded-lg border border-border-line bg-deep-void shadow-2xl overflow-hidden glow-cyan transition-all duration-300">
          
          {/* Header */}
          <div className="bg-[#121214] px-4 py-3 flex items-center justify-between border-b border-border-line select-none">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-lyra-cyan" />
              <span className="text-xs font-mono text-text-primary">Tool-FS Simulator (TCP://127.0.0.1:9000)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono text-text-muted">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sandbox mode</span>
            </div>
          </div>

          {/* Console Output area */}
          <div className="h-96 p-6 overflow-y-auto font-mono text-xs text-text-primary/90 space-y-2 leading-relaxed bg-deep-void">
            {history.map((line, idx) => {
              let color = "text-text-primary/90";
              if (line.startsWith("//")) color = "text-text-muted/60";
              else if (line.startsWith("Type 'help'")) color = "text-text-muted";
              else if (line.startsWith("$ ")) color = "text-lyra-cyan font-bold";
              else if (line.startsWith("Error")) color = "text-red-400";
              else if (line.startsWith("✔")) color = "text-emerald-400";
              
              return (
                <div key={idx} className={`whitespace-pre-wrap ${color}`}>
                  {line}
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>

          {/* Input Form */}
          <form onSubmit={handleCommand} className="border-t border-border-line bg-[#121214] flex items-center px-4 py-3 relative">
            <span className="text-lyra-cyan font-mono text-xs mr-2 font-bold select-none">$</span>
            <input 
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="e.g. /tools/list, help..."
              className="flex-1 bg-transparent text-text-primary font-mono text-xs border-0 outline-none placeholder:text-text-muted/40 cursor-none"
            />
            <button 
              type="submit"
              className="p-1 text-text-muted hover:text-lyra-cyan transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

        </div>

      </div>
    </section>
  );
}
