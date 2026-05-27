import path from "node:path";

import { describe, expect, test } from "vitest";

import { runtimeClientInternalsForTests } from "./runtime-client";

describe("Lyra runtime client", () => {
  test("starts lyrad with Lyra Agent storage aliases under the Agent module root", () => {
    const env = runtimeClientInternalsForTests.buildRuntimeDaemonEnv(
      {
        PATH: "/bin",
        LYRA_AGENT_HOME: "/legacy/.lyra-agent",
        LYRA_AGENT_RUNTIME_DIR: "/legacy/lyra-agent-runtime",
        JCODE_HOME: "/legacy/.jcode",
        JCODE_RUNTIME_DIR: "/legacy/runtime"
      },
      {
        storageRoot: "/Users/tester/.lyra/modules/runtime",
        agentStorageRoot: "/Users/tester/.lyra/modules/agent"
      },
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );

    expect(env.PATH).toBe("/bin");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("");
    expect(env.LYRA_AGENT_HOME).toBe("/Users/tester/.lyra/modules/agent");
    expect(env.LYRA_AGENT_RUNTIME_DIR).toBe(
      path.join("/Users/tester/.lyra/modules/agent", "runtime")
    );
    expect(env.JCODE_HOME).toBe("/Users/tester/.lyra/modules/agent");
    expect(env.JCODE_RUNTIME_DIR).toBe(
      path.join("/Users/tester/.lyra/modules/agent", "runtime")
    );
    expect(env.LYRA_JS_REPL_NODE_PATH).toBe(
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );
    expect(env.LYRA_JS_REPL_NODE_RUN_AS_NODE).toBe("1");
    expect(env.LYRA_DESIGN_NODE_PATH).toBe(
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );
    expect(env.LYRA_DESIGN_NODE_RUN_AS_NODE).toBe("1");
    expect(env.LYRA_DESIGN_NODE_PATHS).toContain("node_modules");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toContain("playwright-browsers");
  });

  test("preserves explicit Playwright browser bundle override", () => {
    const env = runtimeClientInternalsForTests.buildRuntimeDaemonEnv(
      {
        PLAYWRIGHT_BROWSERS_PATH: "/custom/ms-playwright"
      },
      {
        storageRoot: "/Users/tester/.lyra/modules/runtime",
        agentStorageRoot: "/Users/tester/.lyra/modules/agent"
      },
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/custom/ms-playwright");
  });
});
