import { describe, expect, test } from "vitest";

import type { FileManagerEntry, FileManagerTrashEntry } from "../../../../shared/file-manager";
import { resolveFileManagerEntryIconKind } from "../entry-icon-classifier";

type FileManagerFileEntry = Extract<FileManagerEntry, { readonly kind: "file" }>;

const createFileEntry = (overrides: Partial<FileManagerFileEntry> = {}): FileManagerFileEntry => ({
  id: "entry-file",
  name: "index.ts",
  path: "/workspace/index.ts",
  kind: "file",
  extension: "ts",
  isHidden: false,
  ...overrides
});

const createDirectoryEntry = (folderState: "empty" | "non-empty" | "unknown"): FileManagerEntry => ({
  id: "entry-directory",
  name: "src",
  path: "/workspace/src",
  kind: "directory",
  folderState,
  isHidden: false
});

const createTrashFileEntry = (overrides: Partial<FileManagerTrashEntry> = {}): FileManagerTrashEntry => ({
  id: "trash-file",
  name: "package-lock.json",
  kind: "file",
  extension: "json",
  trashedPath: "/trash/package-lock.json",
  originalPath: "/workspace/package-lock.json",
  isHidden: false,
  ...overrides
});

describe("file manager entry icon classifier", () => {
  test("resolves folder icon by folder state", () => {
    expect(resolveFileManagerEntryIconKind(createDirectoryEntry("empty"))).toBe("directory-empty");
    expect(resolveFileManagerEntryIconKind(createDirectoryEntry("non-empty"))).toBe("directory-non-empty");
    expect(resolveFileManagerEntryIconKind(createDirectoryEntry("unknown"))).toBe("directory-non-empty");
  });

  test("distinguishes same json extension by semantics", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "package.json",
          extension: "json"
        })
      )
    ).toBe("package-manifest");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "tsconfig.json",
          extension: "json"
        })
      )
    ).toBe("config");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "user-data.json",
          extension: "json"
        })
      )
    ).toBe("json-data");
  });

  test("classifies workflows and container descriptors", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "build.yml",
          path: "/repo/.github/workflows/build.yml",
          extension: "yml"
        })
      )
    ).toBe("workflow");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "docker-compose.yml",
          path: "/repo/docker-compose.yml",
          extension: "yml"
        })
      )
    ).toBe("container");
  });

  test("classifies secret and certificate files", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: ".env.production",
          extension: "production"
        })
      )
    ).toBe("secret");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "tls.crt",
          extension: "crt"
        })
      )
    ).toBe("certificate");
  });

  test("classifies text and code language categories", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "README.md",
          extension: "md"
        })
      )
    ).toBe("markdown");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "main.rs",
          extension: "rs"
        })
      )
    ).toBe("rust");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "script.ps1",
          extension: "ps1"
        })
      )
    ).toBe("shell");
  });

  test("classifies richer frontend and language identities", () => {
    expect(resolveFileManagerEntryIconKind(createFileEntry({
      name: "App.tsx",
      extension: "tsx"
    }))).toBe("react");
    expect(resolveFileManagerEntryIconKind(createFileEntry({
      name: "App.vue",
      extension: "vue"
    }))).toBe("vue");
    expect(resolveFileManagerEntryIconKind(createFileEntry({
      name: "theme.module.scss",
      extension: "scss"
    }))).toBe("css");
    expect(resolveFileManagerEntryIconKind(createFileEntry({
      name: "main.go",
      extension: "go"
    }))).toBe("go");
    expect(resolveFileManagerEntryIconKind(createFileEntry({
      name: "model.safetensors",
      extension: "safetensors"
    }))).toBe("model");
  });

  test("classifies media and archive files", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "cover.png",
          extension: "png"
        })
      )
    ).toBe("image");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "song.flac",
          extension: "flac"
        })
      )
    ).toBe("audio");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "movie.mkv",
          extension: "mkv"
        })
      )
    ).toBe("video");

    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "bundle.tar.gz",
          extension: "gz"
        })
      )
    ).toBe("archive");
  });

  test("classifies trash entries with same rules", () => {
    expect(resolveFileManagerEntryIconKind(createTrashFileEntry())).toBe("dependency-lock");
  });

  test("falls back to unknown for unmapped extension", () => {
    expect(
      resolveFileManagerEntryIconKind(
        createFileEntry({
          name: "notes.custom",
          extension: "custom"
        })
      )
    ).toBe("unknown");
  });
});
