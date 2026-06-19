import type { MDXComponents } from "mdx/types";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { RenderShowcase } from "./render-showcase-dynamic";
import { TopbarShowcase } from "./topbar-showcase";
import { WorkspaceTabsShowcase } from "./workspace-tabs-showcase";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    RenderShowcase,
    TopbarShowcase,
    WorkspaceTabsShowcase,
    ...components
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
