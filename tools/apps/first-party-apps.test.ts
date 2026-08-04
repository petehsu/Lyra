import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import * as React from "react";
import * as ReactDomClient from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";

import {
  validateLyraAppModule,
  type HostHandlerV1,
  type JsonValue,
  type LyraHostApiV1
} from "../../packages/app-runtime/src/index.ts";
import { installFirstPartyUiRuntime } from "../../packages/workbench-ui-runtime/src/host.ts";

installFirstPartyUiRuntime({
  react: React,
  reactDomClient: ReactDomClient,
  jsxRuntime: ReactJsxRuntime
});

const APPS = [
  ["lyra-browser", "lyra.browser", "browser"],
  ["lyra-files", "lyra.files", "file-manager"],
  ["lyra-editor", "lyra.editor", "file-editor"],
  ["lyra-images", "lyra.images", "image-viewer"],
  ["lyra-terminal", "lyra.terminal", "terminal"],
  ["lyra-downloads", "lyra.downloads", "downloads"],
  ["lyra-agent", "lyra.agent", "agent-solo"],
  ["lyra-credentials", "lyra.credentials", "login-manager"],
  ["lyra-notifications", "lyra.notifications", "notification-center"]
] as const;

test("builds nine independently loadable first-party application modules", async () => {
  for (const [directory, componentId, appId] of APPS) {
    const commands = new Map<string, HostHandlerV1>();
    const executions: Array<{ readonly commandId: string; readonly input: JsonValue }> = [];
    const host: LyraHostApiV1 = {
      apiVersion: "1.0.0",
      executeCommand: async (commandId, input) => {
        executions.push({ commandId, input });
        return null;
      },
      invokeCapability: async () => null,
      registerCommand: (commandId, handler) => {
        commands.set(commandId, handler);
        return {
          dispose: () => {
            if (commands.get(commandId) === handler) commands.delete(commandId);
          }
        };
      },
      registerCapability: () => ({ dispose() {} }),
      subscribeEvent: () => ({ dispose() {} })
    };
    const entry = path.resolve("apps", directory, "dist", "index.mjs");
    const packageDocument = JSON.parse(
      await readFile(path.resolve("apps", directory, "package.json"), "utf8")
    ) as { readonly version?: unknown };
    const source = await readFile(entry, "utf8");
    assert.equal(/from\s+["']react(?:-dom)?/u.test(source), false);
    assert.equal(source.includes("@lyra/first-party-app-kit"), false);
    assert.equal(source.includes("@workbench/"), false);
    assert.equal(source.includes("@renderer/"), false);
    assert.equal(source.includes("apps/desktop/src"), false);
    assert.equal(source.includes("monaco-editor/esm"), false);

    const namespace = await import(`${pathToFileURL(entry).href}?test=${Date.now()}-${directory}`);
    const module = namespace.lyraAppModule ?? namespace.default;
    assert.equal(validateLyraAppModule(module), true, `${componentId} exported an invalid module`);
    assert.equal(module.id, componentId);
    assert.equal(
      module.version,
      packageDocument.version,
      `${componentId} bundle version differs from its private package`
    );
    await module.activate(host);
    const instance = await module.create({
      host,
      appId,
      instanceId: `${componentId}-test`,
      route: "/"
    });
    assert.deepEqual(await module.snapshot(instance), {});
    if (componentId === "lyra.files") {
      await commands.get("lyra.files.refresh")?.({ instanceId: instance.instanceId });
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.files.navigate",
        input: { instanceId: instance.instanceId, direction: "refresh" }
      });
    }
    if (componentId === "lyra.editor") {
      await commands.get("lyra.editor.save")?.({ instanceId: instance.instanceId });
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.editor.save",
        input: { instanceId: instance.instanceId }
      });
    }
    if (componentId === "lyra.browser") {
      await commands.get("lyra.browser.new-tab")?.({
        instanceId: instance.instanceId,
        input: "https://example.com/"
      });
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.browser.open-tab",
        input: {
          instanceId: instance.instanceId,
          input: "https://example.com/"
        }
      });
    }
    if (componentId === "lyra.terminal") {
      await commands.get("lyra.terminal.new-session")?.({
        cwd: "/project"
      });
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.terminal.create",
        input: { cwd: "/project" }
      });
    }
    if (componentId === "lyra.downloads") {
      await commands.get("lyra.downloads.pause-all")?.({});
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.downloads.pause-all",
        input: {}
      });
    }
    if (componentId === "lyra.credentials") {
      await commands.get("lyra.credentials.refresh")?.({});
      assert.deepEqual(executions.at(-1), {
        commandId: "lyra.core.credentials.read",
        input: {}
      });
    }
    await module.close(instance);
    await module.deactivate();
    assert.equal(commands.size, 0, `${componentId} leaked registered commands`);
  }
});
