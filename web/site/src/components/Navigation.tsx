"use client";

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { X, Monitor, Cpu, Terminal, Download, ShieldCheck } from 'lucide-react';

export default function Navigation() {
  const t = useTranslations('Navigation');
  const pathname = usePathname();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const currentLocale = pathname.startsWith('/zh') ? 'zh' : 'en';
  const otherLocale = currentLocale === 'en' ? 'zh' : 'en';

  return (
    <>
      <nav className="fixed top-0 w-full z-50 bg-[#1e4bfa]/95 backdrop-blur-md border-b border-white/20 select-none">
        <div className="site-grid items-center h-16 max-w-7xl mx-auto w-full px-6">
          
          {/* Left: Logo */}
          <div className="col-span-6 md:col-span-3 h-full flex items-center">
            <Link href="/" className="font-serif text-3xl tracking-tight text-white hover:opacity-80 transition-opacity">
              LYRA
            </Link>
          </div>

          {/* Center: Links */}
          <div className="hidden md:flex col-span-6 h-full items-center justify-center gap-12 text-swiss text-xs font-bold">
            <Link href="#features" className="text-white/70 hover:text-white transition-colors tracking-widest">{t('features')}</Link>
            <Link href="#architecture" className="text-white/70 hover:text-white transition-colors tracking-widest">{t('docs')}</Link>
            <Link href="#pricing" className="text-white/70 hover:text-white transition-colors tracking-widest">{t('pricing')}</Link>
          </div>

          {/* Right: Controls */}
          <div className="col-span-6 md:col-span-3 h-full flex items-center justify-end gap-8 text-swiss text-xs">
            <a 
              href={`/${otherLocale}`}
              className="text-white/70 hover:text-white transition-colors font-bold tracking-widest"
            >
              {otherLocale.toUpperCase()}
            </a>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="px-5 py-2 bg-white text-[#1e4bfa] border border-white font-mono font-bold tracking-widest hover:bg-white/90 transition-all uppercase text-[10px]"
            >
              {t('download')}
            </button>
          </div>

        </div>
      </nav>

      {/* Download Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] bg-[#1e4bfa]/85 backdrop-blur-md flex items-center justify-center p-6 select-none">
          <div className="w-full max-w-2xl rounded-none border-2 border-white bg-[#1e4bfa] relative font-sans text-white">
            
            {/* Close */}
            <button 
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors cursor-none"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-8">
              <div className="mb-6">
                <span className="text-swiss text-white/55 font-bold tracking-widest block mb-2">// SHELL BINARY RETRIEVAL</span>
                <h3 className="font-serif text-3xl tracking-tight text-white uppercase">Download Lyra Workbench</h3>
                <p className="text-xs text-white/70 mt-1">Select the runtime target bundle. Production release v0.2.4</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {/* macOS */}
                <div className="p-4 rounded-none border border-white/40 bg-white/5 flex flex-col justify-between h-40">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-white">macOS</span>
                      <Cpu className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-[10px] text-white/70 font-light leading-relaxed block">
                      Intel & Apple Silicon architectures. Universal DMG package.
                    </span>
                  </div>
                  <button className="w-full py-2 bg-white text-[#1e4bfa] text-xs font-mono font-bold rounded-none hover:bg-white/90 transition-transform flex items-center justify-center gap-1 cursor-none">
                    <Download className="w-3.5 h-3.5" /> Universal DMG
                  </button>
                </div>

                {/* Windows */}
                <div className="p-4 rounded-none border border-white/40 bg-white/5 flex flex-col justify-between h-40">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-white">Windows</span>
                      <Monitor className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-[10px] text-white/70 font-light leading-relaxed block">
                      Windows 10/11 x64 systems. Standalone EXE installer.
                    </span>
                  </div>
                  <button className="w-full py-2 bg-transparent text-white border border-white text-xs font-mono font-bold rounded-none hover:bg-white/10 transition-colors flex items-center justify-center gap-1 cursor-none">
                    <Download className="w-3.5 h-3.5" /> Standalone EXE
                  </button>
                </div>

                {/* Linux */}
                <div className="p-4 rounded-none border border-white/40 bg-white/5 flex flex-col justify-between h-40">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-white">Linux</span>
                      <Terminal className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-[10px] text-white/70 font-light leading-relaxed block">
                      AppImage format or curl installer for native headless daemons.
                    </span>
                  </div>
                  <button className="w-full py-2 bg-transparent text-white border border-white text-xs font-mono font-bold rounded-none hover:bg-white/10 transition-colors flex items-center justify-center gap-1 cursor-none">
                    <Download className="w-3.5 h-3.5" /> AppImage
                  </button>
                </div>
              </div>

              {/* CLI command */}
              <div className="bg-[#143bc3] p-4 rounded-none border border-white/30 font-mono text-xs">
                <div className="text-[10px] text-white/50 mb-2">// QUICK NATIVE DAEMON INSTALL (macOS/Linux)</div>
                <div className="flex items-center justify-between text-white">
                  <span>curl -fsSL https://lyra.dev/install.sh | sh</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-white text-[#1e4bfa] rounded-none font-bold">Copy</span>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-1.5 text-[10px] text-white/60 justify-center">
                <ShieldCheck className="w-4 h-4" />
                <span>SHA-256 verified signatures and code-signed certificates.</span>
              </div>

            </div>

          </div>
        </div>
      )}
    </>
  );
}
