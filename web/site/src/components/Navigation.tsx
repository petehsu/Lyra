"use client";

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const t = useTranslations('Navigation');
  const pathname = usePathname();

  const currentLocale = pathname.startsWith('/zh') ? 'zh' : 'en';
  const otherLocale = currentLocale === 'en' ? 'zh' : 'en';

  return (
    <nav className="fixed top-0 w-full z-50 bg-deep-void/90 backdrop-blur-md border-b-grid">
      <div className="site-grid items-center h-16">
        
        {/* Left: Logo (Spans 3 cols) */}
        <div className="col-span-6 md:col-span-3 h-full border-r-grid flex items-center px-6 md:px-12">
          <Link href="/" className="font-editorial text-2xl tracking-wide hover:text-text-muted transition-colors">
            Lyra.
          </Link>
        </div>

        {/* Center: Links (Spans 6 cols) */}
        <div className="hidden md:flex col-span-6 h-full border-r-grid items-center justify-center gap-12 text-swiss">
          <Link href="/" className="hover:text-text-muted transition-colors">{t('features')}</Link>
          <Link href="/" className="hover:text-text-muted transition-colors">{t('docs')}</Link>
          <Link href="/" className="hover:text-text-muted transition-colors">{t('pricing')}</Link>
        </div>

        {/* Right: Controls (Spans 3 cols) */}
        <div className="col-span-6 md:col-span-3 h-full flex items-center justify-end px-6 md:px-12 gap-8 text-swiss">
          <a 
            href={`/${otherLocale}`}
            className="hover:text-text-muted transition-colors"
          >
            {otherLocale}
          </a>
          <button className="hover:text-text-muted transition-colors">
            {t('download')}
          </button>
        </div>

      </div>
    </nav>
  );
}
