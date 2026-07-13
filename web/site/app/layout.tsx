import type { Metadata } from "next";
import Script from "next/script";
import type { CSSProperties } from "react";
import "@fontsource/zen-dots/400.css";
import "../components/gradual-blur.css";
import "./globals.css";

const themeScript = `
  (() => {
    try {
      const stored = localStorage.getItem("lyra-site-theme");
      const theme =
        stored === "light" || stored === "dark"
          ? stored
          : matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {}
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://lyra.ltd"),
  title: {
    default: "Lyra — Desktop Agent",
    template: "%s — Lyra"
  },
  description:
    "Lyra is a desktop workbench shared by you and your Agents, carrying tasks across the web, terminals, files, and apps.",
  applicationName: "Lyra",
  icons: {
    icon: "/lyra-mark.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="lyra-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body
        suppressHydrationWarning
        style={{ "--ipage-max-width": "1400px" } as CSSProperties}
      >
        {children}
      </body>
    </html>
  );
}
