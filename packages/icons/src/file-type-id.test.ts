import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveFileTypeIconId } from "./file-type-id";

test("rust files resolve to the vscode-icons rust mark", () => {
  assert.equal(resolveFileTypeIconId("main.rs"), "vscode-icons:file-type-rust");
});

test("tsx files resolve to the react typescript mark", () => {
  assert.equal(resolveFileTypeIconId("app.tsx"), "vscode-icons:file-type-reactts");
});

test("gitignore resolves to the git mark", () => {
  assert.equal(resolveFileTypeIconId(".gitignore"), "vscode-icons:file-type-git");
});

test("dockerfile resolves to a docker mark", () => {
  const icon = resolveFileTypeIconId("Dockerfile");
  assert.match(icon, /^vscode-icons:file-type-docker/u);
});

test("markdown files resolve to the vscode-icons markdown mark", () => {
  assert.equal(resolveFileTypeIconId("README.md"), "vscode-icons:file-type-markdown");
  assert.equal(resolveFileTypeIconId("notes.mdc"), "vscode-icons:file-type-markdown");
});

test("common media and shell aliases resolve to typed marks", () => {
  assert.equal(resolveFileTypeIconId("photo.png"), "vscode-icons:file-type-image");
  assert.equal(resolveFileTypeIconId("run.sh"), "vscode-icons:file-type-shell");
  assert.equal(resolveFileTypeIconId("data.csv"), "vscode-icons:file-type-excel");
});

test("unknown files fall back to the default file mark", () => {
  assert.equal(resolveFileTypeIconId("untitled"), "vscode-icons:default-file");
});

test("src folders resolve to a folder mark", () => {
  const icon = resolveFileTypeIconId("src", "folder");
  assert.match(icon, /^vscode-icons:(?:folder-type-src|default-folder)$/u);
});
