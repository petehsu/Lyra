import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPromoVideoHasAudio,
  buildPromoManifest,
  looksLikeServiceRoleKey,
  parseFfprobeAudioCodecs,
  shouldTranscodePromo,
  storageAuthHeaders,
  PROMO_MANIFEST_OBJECT,
  PROMO_PUBLIC_BASE,
  PROMO_VIDEO_OBJECT
} from "./publish-promo-video.ts";

test("hot-update keeps a stable pointer and busts the video cache", () => {
  const manifest = buildPromoManifest("2026-09-16T12:00:00.000Z");
  assert.equal(
    manifest.videoUrl,
    `${PROMO_PUBLIC_BASE}/${PROMO_VIDEO_OBJECT}?v=2026-09-16T12%3A00%3A00.000Z`
  );
  assert.equal(manifest.updatedAt, "2026-09-16T12:00:00.000Z");
  assert.equal(PROMO_MANIFEST_OBJECT, "manifest.json");
});

test("silent encodes are rejected before upload", () => {
  assert.deepEqual(parseFfprobeAudioCodecs("aac\n"), ["aac"]);
  assert.throws(
    () => assertPromoVideoHasAudio(parseFfprobeAudioCodecs("")),
    /no audio track/u
  );
});

test("service role env must be a key, not a note", () => {
  assert.equal(looksLikeServiceRoleKey("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example"), true);
  assert.equal(looksLikeServiceRoleKey("sb_secret_example"), true);
  assert.equal(looksLikeServiceRoleKey("Dashboard Settings API"), false);
});

test("files over the Storage cap are transcoded before upload", () => {
  assert.equal(shouldTranscodePromo(45 * 1024 * 1024), false);
  assert.equal(shouldTranscodePromo(45 * 1024 * 1024 + 1), true);
});

test("new secret keys go on apikey only so Storage does not parse them as JWT", () => {
  const secret = storageAuthHeaders("sb_secret_example");
  assert.equal(secret.apikey, "sb_secret_example");
  assert.equal(secret.Authorization, undefined);
  const legacy = storageAuthHeaders("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example");
  assert.equal(legacy.Authorization, "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example");
});
