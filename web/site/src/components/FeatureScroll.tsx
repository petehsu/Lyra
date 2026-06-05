"use client";

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

export default function FeatureScroll() {
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
    <section ref={container} className="h-screen w-full overflow-hidden bg-deep-void flex items-center relative border-b-grid">
      
      <div ref={scrollWrapper} className="flex h-full items-center">
        {/* Panel 1 */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 md:col-span-8 border-r-grid p-6 md:p-12 flex flex-col justify-center">
            <div className="text-swiss-num text-text-muted opacity-20 mb-8">01</div>
            <h2 className="heading-editorial mb-8">Structural</h2>
            <p className="font-editorial text-2xl text-text-muted max-w-xl">
              Strict adherence to grid constraints ensures every subagent operates within a highly organized, predictable workspace.
            </p>
          </div>
          <div className="hidden md:flex col-span-4 p-12 items-center justify-center border-r-grid">
            {/* Minimalist diagram */}
            <div className="w-full aspect-square border border-border-line relative">
              <div className="absolute inset-0 m-8 border border-border-line"></div>
              <div className="absolute inset-0 m-16 border border-border-line"></div>
            </div>
          </div>
        </div>

        {/* Panel 2 */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 md:col-span-8 border-r-grid p-6 md:p-12 flex flex-col justify-center">
            <div className="text-swiss-num text-text-muted opacity-20 mb-8">02</div>
            <h2 className="heading-editorial mb-8">Precision</h2>
            <p className="font-editorial text-2xl text-text-muted max-w-xl">
              Zero tolerance for hallucinations. By routing output directly to system kernels, every action is verified and absolute.
            </p>
          </div>
          <div className="hidden md:flex col-span-4 p-12 items-center justify-center border-r-grid">
            <div className="w-full aspect-square rounded-full border border-border-line relative flex items-center justify-center">
              <div className="w-[1px] h-full bg-border-line"></div>
              <div className="h-[1px] w-full bg-border-line absolute"></div>
            </div>
          </div>
        </div>

        {/* Panel 3 */}
        <div className="feature-panel w-screen h-full flex-shrink-0 site-grid">
          <div className="col-span-12 md:col-span-8 border-r-grid p-6 md:p-12 flex flex-col justify-center">
            <div className="text-swiss-num text-text-muted opacity-20 mb-8">03</div>
            <h2 className="heading-editorial mb-8">Clarity</h2>
            <p className="font-editorial text-2xl text-text-muted max-w-xl">
              We remove the unnecessary. The terminal interface is stripped down to its bare essence, maximizing developer focus.
            </p>
          </div>
          <div className="hidden md:flex col-span-4 p-12 items-center justify-center border-r-grid">
            <div className="w-full aspect-square flex flex-col justify-between">
              <div className="w-full h-[1px] bg-border-line"></div>
              <div className="w-full h-[1px] bg-border-line"></div>
              <div className="w-full h-[1px] bg-border-line"></div>
              <div className="w-full h-[1px] bg-border-line"></div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
