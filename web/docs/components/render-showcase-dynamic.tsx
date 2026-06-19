"use client";

import dynamic from "next/dynamic";

const RenderShowcaseClient = dynamic(
  () => import("./render-showcase").then((module) => module.RenderShowcase),
  {
    ssr: false,
    loading: () => <div className="lyra-docs-render-loading">Loading render pipeline…</div>
  }
);

export function RenderShowcase() {
  return <RenderShowcaseClient />;
}