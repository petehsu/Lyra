import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  COMPLETE_FIRST_PARTY_APP_IDS_V1,
  FIRST_PARTY_APP_RELEASE_CONTRACTS_V1,
  isCompleteFirstPartyAppId
} from "./first-party-app-release.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("complete first-party app release contract", () => {
  test("complete IDs are a subset of the nine first-party app contracts", () => {
    const contracted = new Set(
      FIRST_PARTY_APP_RELEASE_CONTRACTS_V1.map(([componentId]) => componentId)
    );
    for (const componentId of COMPLETE_FIRST_PARTY_APP_IDS_V1) {
      assert.equal(contracted.has(componentId), true, componentId);
      assert.equal(isCompleteFirstPartyAppId(componentId), true);
    }
    assert.equal(isCompleteFirstPartyAppId("lyra.files"), false);
    assert.equal(isCompleteFirstPartyAppId("lyra.editor"), false);
  });

  test("matches Core workspace-app registry complete surfaces", async () => {
    const source = await readFile(
      path.join(
        repository,
        "apps/desktop/src/modules/workbench/workspace-apps/registry.ts"
      ),
      "utf8"
    );
    const block = /export const BUILTIN_PRODUCT_COMPONENTS = \[([\s\S]*?)\] as const/u.exec(source);
    assert.ok(block?.[1]);
    const complete = [...block[1].matchAll(
      /componentId: "(lyra\.[a-z.]+)"[\s\S]*?surfaceReadiness: "(complete|preview)"/gu
    )].flatMap((match) => match[2] === "complete" ? [match[1]] : []);
    assert.deepEqual([...complete].sort(), [...COMPLETE_FIRST_PARTY_APP_IDS_V1].sort());
  });
});
