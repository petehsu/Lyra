import type { Metadata } from "next";
import { LEGAL_META } from "@/lib/legal";
import "./legal.css";

const isPublished = LEGAL_META.status === "effective";

export const metadata: Metadata = {
  title: {
    default: "Legal",
    template: "%s — Lyra Legal"
  },
  description:
    "Lyra terms, privacy policy, provider register, third-party notices, and legal version history.",
  robots: {
    index: isPublished,
    follow: isPublished,
    nocache: !isPublished
  }
};

export default function LegalLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
