import assert from "node:assert/strict";
import test from "node:test";

import { parseCredentialsSnapshot } from "./src/parse.ts";

test("keeps Core session and credential rows without secrets", () => {
  const snapshot = parseCredentialsSnapshot({
    generatedAt: "2026-07-31T00:00:00.000Z",
    passwordsAvailable: true,
    sessions: [{
      id: "session-1",
      origin: "https://example.com",
      hostname: "example.com",
      authMethod: { kind: "password", label: "Password", source: "observed" },
      authMethodSource: "observed",
      lastSeenAt: "2026-07-31T00:00:00.000Z"
    }],
    credentials: [{
      id: "credential-1",
      origin: "https://example.com",
      hostname: "example.com",
      username: "pete@example.com",
      authMethod: { label: "Password" },
      passwordAvailable: true,
      updatedAt: "2026-07-31T00:00:00.000Z"
    }]
  });
  assert.equal(snapshot.sessions[0]?.hostname, "example.com");
  assert.equal(snapshot.credentials[0]?.username, "pete@example.com");
  assert.equal(snapshot.credentials[0]?.authMethod.kind, "unknown");
  assert.equal("password" in (snapshot.credentials[0] ?? {}), false);
});

test("rejects a Core payload without session and credential arrays", () => {
  assert.throws(
    () => parseCredentialsSnapshot({ sessions: [] }),
    /invalid credential snapshot/u
  );
});
