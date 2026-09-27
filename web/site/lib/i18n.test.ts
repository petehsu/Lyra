import assert from "node:assert/strict";
import test from "node:test";
import { getDictionary, SITE_LOCALES } from "./i18n";

function stringEntries(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    stringEntries(child, `${path}.${key}`)
  );
}

test("Chinese and English have the same non-empty copy fields", () => {
  const zh = stringEntries(getDictionary("zh"));
  const en = stringEntries(getDictionary("en"));
  assert.deepEqual(zh.map(([key]) => key), en.map(([key]) => key));
  for (const [key, text] of [...zh, ...en]) {
    assert.ok(text.trim().length > 0, `${key} must not be an empty placeholder`);
  }
});

for (const locale of SITE_LOCALES) {
  test(`${locale}: preserve the chosen brand lines without restoring hero filler`, () => {
    const copy = getDictionary(locale);
    assert.equal(copy.hero.title, "Anything? Lyra.");
    assert.equal(copy.footer.statement, "Anything. Anytime. Anywhere. And more.");
    assert.deepEqual(Object.keys(copy.hero), ["title", "previewCaption"]);
  });

  test(`${locale}: keep requested plans and platform roadmap without invented benefits`, () => {
    const copy = getDictionary(locale);
    assert.deepEqual(copy.pricing.plans.map(({ name }) => name), ["Free", "Pro", "Max"]);
    assert.deepEqual(copy.pricing.plans.map(({ available }) => available), [true, false, false]);
    assert.ok(copy.pricing.plans.slice(1).every(({ points }) => points.length === 0));
    assert.equal(copy.download.upcoming.length, 2);
    assert.equal(copy.download.upcoming[1], "CLI");
    assert.deepEqual(copy.download.platforms.map(({ id }) => id), ["macos", "windows", "linux"]);
    const text = stringEntries(copy).map(([, value]) => value).join("\n");
    assert.doesNotMatch(text, /工作现场|不是试用页面|不会提前承诺|等待中|待定|working scene|TBD|I will not promise/i);
  });

  test(`${locale}: keep model costs, cloud data, and contact boundaries explicit`, () => {
    const copy = getDictionary(locale);
    assert.match(copy.pricing.note, locale === "zh" ? /服务商/ : /provider/);
    assert.match(copy.local.points.join(" "), locale === "zh" ? /云端模型.*接收/ : /Cloud models receive/);
    assert.match(copy.contact.personalNotice, locale === "zh" ? /请勿.*密码.*API/ : /Do not send passwords, API keys/);
    assert.equal(copy.product.items.length, 3);
  });
}
