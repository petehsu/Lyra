"use client";

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Check, ShieldAlert, BadgeInfo, Zap, CircleCheck } from 'lucide-react';

export default function PricingSection() {
  const t = useTranslations('Pricing');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const plans = [
    {
      id: "community",
      titleKey: "community_name",
      priceKey: "community_price",
      subKey: "community_sub",
      glow: false,
      features: [
        "Self-hosted Rust core engine",
        "Local Hash Vector Embedding",
        "Core Built-in VFS Tools (/tools/*)",
        "Open-source community support",
        "Local SQLite database storage"
      ]
    },
    {
      id: "pro",
      titleKey: "pro_name",
      priceKey: "pro_price",
      subKey: "pro_sub",
      glow: true,
      features: [
        "Cloud Vector Embedding sync",
        "Collaborative multi-agent workspaces",
        "Custom Host FFI Tool SDK",
        "Priority developer support channel",
        "Unlimited session PTY nodes",
        "Granular permission access logging"
      ]
    },
    {
      id: "enterprise",
      titleKey: "enterprise_name",
      priceKey: "enterprise_price",
      subKey: "enterprise_sub",
      glow: false,
      features: [
        "Single-tenant isolated deployment",
        "Enterprise-grade security audit logs",
        "Custom desktop app brand integration",
        "24/7 dedicated support SLA",
        "Active Directory/SSO integration",
        "Unlimited custom FFI platform adapters"
      ]
    }
  ];

  return (
    <section className="py-24 border-b border-border-line relative bg-deep-void">
      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        
        {/* Header */}
        <div className="max-w-3xl mb-16 mx-auto text-center">
          <span className="text-swiss text-lyra-cyan font-bold tracking-widest block mb-3">// LICENSE & LICENSING</span>
          <h2 className="font-editorial text-4xl md:text-5xl lg:text-6xl tracking-tight text-text-primary mb-6">
            {t('title')}
          </h2>
          <p className="text-lg text-text-muted font-light leading-relaxed font-sans">
            {t('subtitle')}
          </p>
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            return (
              <div 
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`p-8 rounded-[var(--radius-card)] border bg-matte-surface/40 flex flex-col justify-between cursor-none transition-all duration-300 relative ${
                  plan.glow ? 'border-lyra-cyan/60 shadow-[0_0_30px_rgba(6,182,212,0.08)] scale-[1.01]' : 'border-border-line/60'
                } ${isSelected ? 'border-lyra-cyan bg-matte-surface/80' : ''}`}
              >
                {/* Popular Badge for Pro */}
                {plan.glow && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-lyra-cyan to-ai-amethyst text-deep-void font-mono font-bold text-[9px] uppercase tracking-wider rounded-full shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                    RECOMMENDED
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-4 select-none">
                    <span className="text-swiss text-text-primary font-bold tracking-wider">{t(plan.titleKey)}</span>
                    {plan.glow && <Zap className="w-4 h-4 text-lyra-cyan fill-lyra-cyan/20" />}
                  </div>
                  
                  <div className="flex items-baseline gap-1 mb-2 select-none">
                    <span className="font-sans font-black text-4xl lg:text-5xl text-text-primary">{t(plan.priceKey)}</span>
                    {plan.id === "pro" && <span className="text-xs font-mono text-text-muted">/ month</span>}
                  </div>
                  
                  <p className="text-xs text-text-muted font-sans font-light leading-relaxed mb-8 select-none">
                    {t(plan.subKey)}
                  </p>

                  <div className="h-[1px] w-full bg-border-line/40 mb-8"></div>

                  <ul className="space-y-4 text-xs font-sans text-text-muted font-light mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <CircleCheck className="w-4 h-4 text-lyra-cyan flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button 
                  className={`w-full py-4 text-xs font-mono font-bold uppercase tracking-widest rounded-[var(--radius-button)] transition-all ${
                    plan.glow 
                      ? 'bg-lyra-cyan text-deep-void hover:bg-lyra-cyan/90 hover:scale-[1.02] shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-transparent text-text-primary border border-border-line hover:bg-white/5'
                  }`}
                >
                  {t('cta')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Pricing disclaimer */}
        <div className="mt-12 text-center text-xs font-mono text-text-muted/50 flex items-center justify-center gap-2 select-none">
          <BadgeInfo className="w-4 h-4" />
          <span>All packages include local agent runtime capabilities and full privacy controls by default.</span>
        </div>

      </div>
    </section>
  );
}
