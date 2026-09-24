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
  assert.equal(resolveFileTypeIconId("new_market.sqlite3"), "vscode-icons:file-type-sqlite");
  assert.equal(resolveFileTypeIconId("notes.sqlite"), "vscode-icons:file-type-sqlite");
});

test("bazel, just, nix lock, and ruff files use their own marks", () => {
  assert.equal(resolveFileTypeIconId("defs.bzl"), "vscode-icons:file-type-bazel");
  assert.equal(resolveFileTypeIconId("MODULE.bazel.lock"), "vscode-icons:file-type-bazel");
  assert.equal(resolveFileTypeIconId("justfile"), "vscode-icons:file-type-just");
  assert.equal(resolveFileTypeIconId("flake.lock"), "vscode-icons:file-type-nix");
  assert.equal(resolveFileTypeIconId("ruff.toml"), "vscode-icons:file-type-ruff");
  assert.equal(resolveFileTypeIconId("LICENSE"), "vscode-icons:file-type-license");
  assert.equal(
    resolveFileTypeIconId("workspace_root_test_launcher.sh.tpl"),
    "vscode-icons:file-type-shell"
  );
  assert.equal(
    resolveFileTypeIconId("workspace_root_test_launcher.bat.tpl"),
    "vscode-icons:file-type-bat"
  );
});

test("language extensions from the reference VS Code tree get a mark", () => {
  assert.equal(resolveFileTypeIconId("page.htm"), "vscode-icons:file-type-html");
  assert.equal(resolveFileTypeIconId("run.cmd"), "vscode-icons:file-type-bat");
  assert.equal(resolveFileTypeIconId("core.clj"), "vscode-icons:file-type-clojure");
  assert.equal(resolveFileTypeIconId("Script.fsi"), "vscode-icons:file-type-fsharp");
  assert.equal(resolveFileTypeIconId("lib.pm"), "vscode-icons:file-type-perl");
  assert.notEqual(resolveFileTypeIconId("Jenkinsfile"), "vscode-icons:default-file");
});

test("media project files reuse a shipped mark", () => {
  assert.equal(resolveFileTypeIconId("edit.prproj"), "vscode-icons:file-type-video");
  assert.equal(resolveFileTypeIconId("comp.aep"), "vscode-icons:file-type-video");
  assert.equal(resolveFileTypeIconId("grade.drp"), "vscode-icons:file-type-video");
  assert.equal(resolveFileTypeIconId("session.als"), "vscode-icons:file-type-audio");
  assert.equal(resolveFileTypeIconId("poster.psb"), "vscode-icons:file-type-photoshop");
  assert.equal(resolveFileTypeIconId("scan.tif"), "vscode-icons:file-type-image");
  assert.equal(resolveFileTypeIconId("shot.ma"), "vscode-icons:file-type-maya");
  assert.equal(resolveFileTypeIconId("clip.mp4"), "vscode-icons:file-type-video");
});

test("unknown files fall back to the default file mark", () => {
  assert.equal(resolveFileTypeIconId("untitled"), "vscode-icons:default-file");
  assert.equal(resolveFileTypeIconId("NOTICE"), "vscode-icons:default-file");
});

test("src folders resolve to a folder mark", () => {
  const icon = resolveFileTypeIconId("src", "folder");
  assert.match(icon, /^vscode-icons:(?:folder-type-src|default-folder)$/u);
});
