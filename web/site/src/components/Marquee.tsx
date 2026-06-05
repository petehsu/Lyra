"use client";

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Star } from 'lucide-react';

export default function Marquee() {
  const container = useRef<HTMLDivElement>(null);
  
  useGSAP(() => {
    gsap.to('.marquee-content', {
      xPercent: -50,
      ease: 'none',
      duration: 20,
      repeat: -1,
    });
  }, { scope: container });

  const items = [
    "RETHINK TERMINAL", "UNLEASH CREATIVITY", "BREAK THE GRID", "AGENT DRIVEN", "NO COMPROMISES"
  ];

  return (
    <section ref={container} className="w-full py-8 border-y-4 border-brutal-green bg-brutal-green text-deep-void overflow-hidden flex transform -skew-y-3 my-32">
      <div className="marquee-container flex whitespace-nowrap">
        <div className="marquee-content flex items-center">
          {[...items, ...items, ...items, ...items].map((text, i) => (
            <div key={i} className="flex items-center gap-12 mx-12">
              <span className="font-sans font-black text-5xl lg:text-7xl uppercase tracking-tighter">{text}</span>
              <Star className="w-10 h-10 fill-deep-void" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
