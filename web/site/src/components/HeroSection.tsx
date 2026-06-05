"use client";

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

export default function HeroSection() {
  const t = useTranslations('Hero');
  const container = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline();
    
    // Animate the mask reveals by moving the inner content to y: 0
    // We assume .mask-inner has transform: translateY(100%) initially in CSS
    // Wait, let's explicitly set the from state to be safe.
    tl.fromTo('.mask-inner', 
      { y: '100%' },
      { y: '0%', duration: 1.5, stagger: 0.15, ease: 'power3.out' }
    );
    
    tl.from('.fade-in-element', {
      opacity: 0,
      y: 20,
      duration: 1.5,
      stagger: 0.2,
      ease: 'power2.out',
    }, "-=1");

  }, { scope: container });

  return (
    <section 
      ref={container} 
      className="relative min-h-screen pt-16 flex flex-col border-b-grid"
    >
      <div className="site-grid flex-1">
        
        {/* Left Column (Spans 1 to 5) */}
        <div className="col-span-12 md:col-span-5 border-r-grid p-6 md:p-12 flex flex-col justify-end">
          <div className="mb-12 md:mb-24 mask-reveal">
            <div className="mask-inner text-swiss">
              VOL 01. NEW PARADIGM
            </div>
          </div>
          
          <h1 className="flex flex-col">
            <div className="mask-reveal">
              <span className="mask-inner block heading-editorial">Agent</span>
            </div>
            <div className="mask-reveal ml-12 md:ml-24">
              <span className="mask-inner block sub-editorial text-text-muted">Native</span>
            </div>
            <div className="mask-reveal">
              <span className="mask-inner block heading-editorial">Terminal.</span>
            </div>
          </h1>
        </div>

        {/* Right Column (Spans 6 to 12) */}
        <div className="col-span-12 md:col-span-7 flex flex-col">
          
          {/* Top Info Bar */}
          <div className="border-b-grid flex-1 p-6 md:p-12 flex items-end">
            <div className="fade-in-element max-w-lg">
              <h2 className="text-swiss mb-6 text-text-muted">Philosophy</h2>
              <p className="font-editorial text-2xl md:text-3xl text-text-primary leading-relaxed">
                True luxury is not loud. It is found in the meticulous attention to negative space, and the structural perfection of code.
              </p>
            </div>
          </div>

          {/* Bottom Visual / Abstract */}
          <div className="flex-1 p-6 md:p-12 relative overflow-hidden flex items-center justify-center">
            <div className="fade-in-element w-full h-full border border-border-line relative flex items-center justify-center">
              <div className="w-[1px] h-full bg-border-line absolute left-1/2"></div>
              <div className="h-[1px] w-full bg-border-line absolute top-1/2"></div>
              <div className="w-32 h-32 rounded-full border border-border-line absolute"></div>
              <span className="text-swiss text-text-muted bg-deep-void px-4 z-10">FORM FOLLOWS FUNCTION</span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
