import type { Metadata } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import Navigation from '@/components/Navigation';
import CustomCursor from '@/components/CustomCursor';
import "../globals.css";

export const metadata: Metadata = {
  title: "Lyra - Agent-Native Terminal",
  description: "Built for the next generation of AI-driven developers.",
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} className="antialiased" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <CustomCursor />
        <NextIntlClientProvider messages={messages}>
          <div className="min-h-screen bg-deep-void flex flex-col">
            <Navigation />
            <div className="pt-20 flex-1">
              {children}
            </div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
