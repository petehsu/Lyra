import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}));

import {
  buildAgentCorePersonaContextForTests,
  resetAgentCorePersonaContextCacheForTests
} from "../service";

const jsonResponse = (payload: Record<string, unknown>): Response =>
  ({
    ok: true,
    json: vi.fn(async () => payload)
  }) as unknown as Response;

const failedResponse = (): Response =>
  ({
    ok: false,
    json: vi.fn()
  }) as unknown as Response;

describe("agent-core persona context", () => {
  afterEach(() => {
    resetAgentCorePersonaContextCacheForTests();
    vi.unstubAllGlobals();
  });

  test("caches successful IP location lookups across persona syncs", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        city: "Shanghai",
        region: "Shanghai",
        country_name: "China",
        ip: "203.0.113.7"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await buildAgentCorePersonaContextForTests();
    const second = await buildAgentCorePersonaContextForTests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.ipLocationDisplay).toBe("Shanghai, Shanghai, China");
    expect(second.ipLocationDisplay).toBe("Shanghai, Shanghai, China");
    expect(first.ipAddress).toBe("203.0.113.7");
    expect(second.ipAddress).toBe("203.0.113.7");
  });

  test("shares a single in-flight IP location lookup", async () => {
    let resolvePayload!: (payload: Record<string, unknown>) => void;
    const payloadPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolvePayload = resolve;
    });
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        json: vi.fn(async () => await payloadPromise)
      }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = buildAgentCorePersonaContextForTests();
    const second = buildAgentCorePersonaContextForTests();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolvePayload({
      city: "Taipei",
      region: "Taipei",
      country_name: "Taiwan"
    });

    const [firstPayload, secondPayload] = await Promise.all([first, second]);
    expect(firstPayload.ipLocationDisplay).toBe("Taipei, Taipei, Taiwan");
    expect(secondPayload.ipLocationDisplay).toBe("Taipei, Taipei, Taiwan");
  });

  test("caches failed IP location lookups briefly", async () => {
    const fetchMock = vi.fn(async () => failedResponse());
    vi.stubGlobal("fetch", fetchMock);

    const first = await buildAgentCorePersonaContextForTests();
    const second = await buildAgentCorePersonaContextForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.ipLocationDisplay).toBe("unknown");
    expect(second.ipLocationDisplay).toBe("unknown");
  });
});
