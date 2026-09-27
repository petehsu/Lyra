import assert from "node:assert/strict";
import test from "node:test";
import { createPreferenceAuthority, isPreferencePatch, isPreferenceSnapshot } from "./preference-sync";

test("website and workbench changes share a single ordered preference snapshot", () => {
  const sync = createPreferenceAuthority({ theme: "light", locale: "zh" });
  assert.equal(sync.update({ theme: "dark" }).revision, 1);
  assert.deepEqual(sync.receive(1, { locale: "en" })?.preferences, { theme: "dark", locale: "en" });
  assert.equal(sync.snapshot().revision, 2);
  assert.deepEqual(sync.receive(2, { theme: "light" })?.preferences, { theme: "light", locale: "en" });
});

test("delayed boot/old preference reports cannot roll back a newer website choice", () => {
  const sync = createPreferenceAuthority({ theme: "light", locale: "en" });
  sync.update({ theme: "dark", locale: "zh" });
  assert.equal(sync.receive(0, { theme: "light", locale: "en" }), null);
  assert.deepEqual(sync.snapshot().preferences, { theme: "dark", locale: "zh" });
});

test("echoes and repeated acknowledgements do not generate new changes", () => {
  const sync = createPreferenceAuthority({ theme: "dark", locale: "zh" });
  for (let i = 0; i < 100; i++) {
    assert.equal(sync.update({ theme: "dark", locale: "zh" }).revision, 0);
    assert.equal(sync.receive(0, { theme: "dark" })?.revision, 0);
  }
});

test("rapid alternating choices keep theme and language independent", () => {
  const sync = createPreferenceAuthority({ theme: "light", locale: "en" });
  for (let i = 0; i < 40; i++) {
    sync.update({ theme: i % 2 ? "light" : "dark" });
    sync.receive(sync.snapshot().revision, { locale: i % 2 ? "en" : "zh" });
  }
  assert.deepEqual(sync.snapshot().preferences, { theme: "light", locale: "en" });
});

test("only finite versioned theme/language preferences enter the bridge", () => {
  for (const invalid of [null, {}, { locale: "fr" }, { theme: "auto" }, { theme: undefined, locale: "zh" }, { locale: "en", script: "bad" }]) {
    assert.equal(isPreferencePatch(invalid), false);
  }
  assert.equal(isPreferenceSnapshot({ type: "lyra:preferences-set", revision: NaN, preferences: { theme: "dark", locale: "zh" } }), false);
  assert.equal(isPreferenceSnapshot(createPreferenceAuthority({ theme: "dark", locale: "zh" }).snapshot()), true);
});

test("shared Chinese resources cover preference controls and the interactive composer", async () => {
  const { filmChinese } = await import("../../../Lyra宣传视频/ui-studio/src/runtime/film-language");
  for (const key of ["settings.theme.lyra-dark", "settings.languageLabel", "lyra-agents-composer.placeholder", "lyra-agents-empty.questionPrefix", "ai.movePanelToRight"]) {
    assert.match(filmChinese[key], /[\u3400-\u9fff]/);
  }
});
