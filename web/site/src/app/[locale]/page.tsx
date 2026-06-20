import { useTranslations } from 'next-intl';
import HeroSection from '@/components/HeroSection';
import FeatureScroll from '@/components/FeatureScroll';
import ArchitectureSection from '@/components/ArchitectureSection';
import CLIDemoSection from '@/components/CLIDemoSection';
import PricingSection from '@/components/PricingSection';
import { Terminal, Github, Twitter, ShieldCheck } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations('Hero');
  
  return (
    <main className="flex-1 flex flex-col">
      <HeroSection />
      <div id="features">
        <FeatureScroll />
      </div>
      <div id="architecture">
        <ArchitectureSection />
      </div>
      <CLIDemoSection />
      <div id="pricing">
        <PricingSection />
      </div>
      
      {/* Polished Developer Footer */}
      <footer className="bg-matte-surface border-t border-border-line py-16 px-6 md:px-12 select-none relative z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 font-sans">
          
          {/* Logo / Meta */}
          <div className="md:col-span-1 flex flex-col justify-between">
            <div>
              <span className="font-editorial text-3xl tracking-wide text-text-primary">Lyra.</span>
              <p className="text-xs text-text-muted mt-3 font-light leading-relaxed">
                Agent-Native Terminal Workbench environment. Engineered for system autonomy and cognitive efficiency.
              </p>
            </div>
            <div className="text-[10px] text-text-muted/40 font-mono mt-8">
              © {new Date().getFullYear()} Lyra Labs Inc. All rights reserved.
            </div>
          </div>

          {/* Links: Features */}
          <div>
            <h4 className="text-xs font-mono font-bold text-text-primary uppercase tracking-widest mb-4">Specs & Docs</h4>
            <ul className="space-y-2.5 text-xs text-text-muted font-light">
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">Tool-FS virtual schema</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">Accessibility Tree hooks</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">SQLite Memory projection</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">Ratchet linter policies</a></li>
            </ul>
          </div>

          {/* Links: Ecosystem */}
          <div>
            <h4 className="text-xs font-mono font-bold text-text-primary uppercase tracking-widest mb-4">Resources</h4>
            <ul className="space-y-2.5 text-xs text-text-muted font-light">
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">Local Daemon CLI (lyrad)</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">N-API Rust client bindings</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">Control Plane integration</a></li>
              <li><a href="#" className="hover:text-lyra-cyan transition-colors">API References</a></li>
            </ul>
          </div>

          {/* Social / Cert */}
          <div className="flex flex-col justify-between items-start">
            <div>
              <h4 className="text-xs font-mono font-bold text-text-primary uppercase tracking-widest mb-4">Connect</h4>
              <div className="flex gap-4 text-text-muted">
                <a href="#" className="hover:text-lyra-cyan transition-colors"><Github className="w-5 h-5" /></a>
                <a href="#" className="hover:text-lyra-cyan transition-colors"><Twitter className="w-5 h-5" /></a>
                <a href="#" className="hover:text-lyra-cyan transition-colors"><Terminal className="w-5 h-5" /></a>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-400/5 px-2.5 py-1 rounded border border-emerald-400/10 mt-8">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Core Audit PASSED</span>
            </div>
          </div>

        </div>
      </footer>
    </main>
  );
}
