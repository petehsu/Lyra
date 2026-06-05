import { useTranslations } from 'next-intl';
import HeroSection from '@/components/HeroSection';
import FeatureScroll from '@/components/FeatureScroll';

export default function HomePage() {
  const t = useTranslations('HomePage');
  
  return (
    <main className="flex-1 flex flex-col">
      <HeroSection />
      <FeatureScroll />
      
      {/* Footer / Spacer */}
      <footer className="h-[50vh] bg-deep-void flex items-center justify-center border-t border-white/10">
        <h2 className="text-4xl md:text-6xl font-black text-white/20 uppercase tracking-tighter">
          Ready to Build.
        </h2>
      </footer>
    </main>
  );
}
