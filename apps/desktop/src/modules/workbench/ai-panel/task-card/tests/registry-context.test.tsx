import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import {
  AiTaskCardRegistryProvider,
  useTaskCardRegistry
} from "../registry";

describe("task-card registry context", () => {
  test("isolates renderers across provider scopes", () => {
    const renderer = () => "scoped-card";

    let scopeKey = "scope-a";
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <AiTaskCardRegistryProvider scopeKey={scopeKey}>
        {children}
      </AiTaskCardRegistryProvider>
    );

    const { result, rerender } = renderHook(() => useTaskCardRegistry(), { wrapper });

    result.current.register("plugin.card", renderer);
    expect(result.current.resolve("plugin.card")).toBe(renderer);

    scopeKey = "scope-b";
    rerender();

    expect(result.current.resolve("plugin.card")).not.toBe(renderer);
  });
});
