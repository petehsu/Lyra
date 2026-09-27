import { strict as assert } from "node:assert";
import { test } from "node:test";
import { localizeFilmEvent } from "../../../Lyra宣传视频/ui-studio/shots/003-opening-sequence/film-copy";

test("film preferences and writes stay in memory, away from the interactive workbench", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { search: "?film=1&locale=zh-CN&theme=dark" },
    get localStorage() { throw new Error("Film accessed shared storage"); }
  } });
  try {
    const state = await import("../../../Lyra宣传视频/ui-studio/src/adapters/state-storage");
    assert.deepEqual(JSON.parse(state.readWorkbenchStateSync("preferences")!), {
      theme: "lyra-dark", locale: "zh-CN", localePreference: { mode: "explicit", locale: "zh-CN" }
    });
    state.writeWorkbenchStateSync("workspace-tabs", "film-only");
    assert.equal(state.readWorkbenchStateSync("workspace-tabs"), "film-only");
    state.removeWorkbenchStateSync("workspace-tabs");
    assert.equal(state.readWorkbenchStateSync("workspace-tabs"), null);
    assert.equal(JSON.parse(state.readWorkbenchStateSync("location")!).consent, "denied");
  } finally {
    if (old) Object.defineProperty(globalThis, "window", old);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("film translation changes narration without rewriting command data", () => {
  const original = { id: "promo-server", tool: { label: "Starting local website", command: "pnpm --filter @lyra/site dev" } };
  const translated = localizeFilmEvent(original);
  assert.equal(translated.tool.label, "正在启动本地网站");
  assert.equal(translated.tool.command, original.tool.command);
  assert.equal(translated.id, original.id);
  assert.equal(original.tool.label, "Starting local website");
});
