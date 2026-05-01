import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  FileManagerDirectoryMutationResponse,
  FileManagerReadDirectoryResponse,
  FileManagerReadHomeResponse,
  FileManagerReadTrashResponse,
  FileReadResult,
  FileStatResult,
  FileWriteResult
} from "../../../shared/file-manager";
import type { FilesNativeBindings } from "../../files/types";
import type { LyraRuntimeClient } from "../../runtime-client";
import { registerFilesystemCapabilities } from "../adapters/files";
import { CapabilityRegistry } from "../registry";

const tempRoots: string[] = [];

const createTempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lyra-files-cap-"));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const readFileRevision = (filePath: string): string =>
  createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const createFakeBindings = (): FilesNativeBindings => {
  const readTextFile = ({ path: filePath }: { readonly path: string }): FileReadResult => {
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return {
        kind: "unsupported",
        path: filePath,
        reason: "binary-not-supported",
        readOnly: false,
        sizeBytes: buffer.byteLength
      };
    }
    return {
      kind: "text",
      path: filePath,
      revision: readFileRevision(filePath),
      encoding: "utf8",
      readOnly: false,
      sizeBytes: buffer.byteLength,
      content: buffer.toString("utf8")
    };
  };

  const writeTextFile = ({
    path: filePath,
    content,
    expectedRevision
  }: {
    readonly path: string;
    readonly content: string;
    readonly expectedRevision?: string;
  }): FileWriteResult => {
    const currentRevision = fs.existsSync(filePath) ? readFileRevision(filePath) : undefined;
    if (
      expectedRevision !== undefined
      && currentRevision !== undefined
      && expectedRevision !== currentRevision
    ) {
      return {
        ok: false,
        kind: "revision-conflict",
        path: filePath,
        expectedRevision,
        currentRevision,
        message: "revision conflict"
      };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return {
      ok: true,
      path: filePath,
      revision: readFileRevision(filePath),
      encoding: "utf8",
      savedAt: new Date(0).toISOString()
    };
  };

  const unsupportedDirectoryRead = (): FileManagerReadDirectoryResponse => {
    throw new Error("not implemented");
  };
  const unsupportedHomeRead = (): FileManagerReadHomeResponse => {
    throw new Error("not implemented");
  };
  const unsupportedTrashRead = (): FileManagerReadTrashResponse => {
    throw new Error("not implemented");
  };
  const unsupportedMutation = (): FileManagerDirectoryMutationResponse => {
    throw new Error("not implemented");
  };
  const unsupportedStat = (): FileStatResult => {
    throw new Error("not implemented");
  };

  return {
    readHome: unsupportedHomeRead,
    readDirectory: unsupportedDirectoryRead,
    subscribeDirectory: vi.fn(() => {
      throw new Error("not implemented");
    }),
    unsubscribeDirectory: vi.fn(() => false),
    pollDirectoryPatches: vi.fn(() => []),
    readTrash: unsupportedTrashRead,
    createFile: unsupportedMutation,
    createFolder: unsupportedMutation,
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    emptyTrash: vi.fn(),
    mountDevice: vi.fn(() => ({ mounted: false, strategy: "noop" })),
    ejectDevice: vi.fn(() => ({ ejected: false, poweredOff: false, strategy: "noop" })),
    readFavorites: vi.fn(() => ({ favorites: [] })),
    writeFavorites: vi.fn((request) => request),
    readRecentLocations: vi.fn(() => ({ recentLocations: [] })),
    writeRecentLocations: vi.fn((request) => request),
    readTextFile,
    writeTextFile,
    statFile: unsupportedStat,
    probeWorkbenchPath: vi.fn(({ path: filePath }) => ({ normalizedPath: filePath })),
    collectWorkbenchFilePaths: vi.fn(() => [])
  };
};

const createFakeRuntimeClient = (): LyraRuntimeClient => ({
  request: vi.fn(async () => {
    throw new Error("runtime unavailable");
  }),
  registerRequestHandler: vi.fn(),
  unregisterRequestHandler: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  dispose: vi.fn()
});

const createRegistry = (
  bindings: FilesNativeBindings,
  storageRoot: string,
  publishEvent = vi.fn()
): CapabilityRegistry => {
  const registry = new CapabilityRegistry(publishEvent);
  registerFilesystemCapabilities(
    registry,
    bindings,
    storageRoot,
    createFakeRuntimeClient(),
    storageRoot
  );
  return registry;
};

describe("filesystem capability adapter", () => {
  test("glob, search, and read_range respect the active workspace root", async () => {
    const storageRoot = createTempRoot();
    const workspaceRoot = createTempRoot();
    fs.mkdirSync(path.join(workspaceRoot, "src", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "app", "page.tsx"),
      [
        "import { HeroSection } from './hero';",
        "",
        "export default function Page() {",
        "  return <HeroSection />;",
        "}"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "README.md"),
      "# Lyra\nAgent workspace",
      "utf8"
    );

    const registry = createRegistry(createFakeBindings(), storageRoot);

    const globResult = await registry.invoke({
      capabilityId: "filesystem.glob",
      payload: {
        pattern: "**/*.tsx"
      },
      context: {
        workspaceRoot
      }
    });
    expect(globResult.ok).toBe(true);
    expect(globResult.result).toEqual(
      expect.objectContaining({
        matches: [
          expect.objectContaining({
            relativePath: "src/app/page.tsx",
            kind: "file"
          })
        ]
      })
    );

    const searchResult = await registry.invoke({
      capabilityId: "filesystem.search",
      payload: {
        pattern: "HeroSection",
        path: "src",
        glob: "**/*.tsx"
      },
      context: {
        workspaceRoot
      }
    });
    expect(searchResult.ok).toBe(true);
    expect(searchResult.result).toEqual(
      expect.objectContaining({
        matches: [
          expect.objectContaining({
            relativePath: "app/page.tsx",
            line: 1
          }),
          expect.objectContaining({
            relativePath: "app/page.tsx",
            line: 4
          })
        ]
      })
    );

    const rangeResult = await registry.invoke({
      capabilityId: "filesystem.read_range",
      payload: {
        path: "src/app/page.tsx",
        startLine: 3,
        endLine: 4
      },
      context: {
        workspaceRoot
      }
    });
    expect(rangeResult.ok).toBe(true);
    expect(rangeResult.result).toEqual(
      expect.objectContaining({
        kind: "text",
        actualStartLine: 3,
        actualEndLine: 4,
        totalLines: 5,
        content: "export default function Page() {\n  return <HeroSection />;"
      })
    );
  });

  test("apply_patch updates an existing file and returns patch metadata", async () => {
    const storageRoot = createTempRoot();
    const workspaceRoot = createTempRoot();
    const targetFile = path.join(workspaceRoot, "src", "app", "page.tsx");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(
      targetFile,
      "export default function OldPage() {\n  return null;\n}\n",
      "utf8"
    );

    const bindings = createFakeBindings();
    const publishEvent = vi.fn();
    const registry = createRegistry(bindings, storageRoot, publishEvent);
    const initialRead = bindings.readTextFile({ path: targetFile });
    const expectedRevision = initialRead.kind === "text" ? initialRead.revision : undefined;

    const pendingResult = registry.invoke({
      capabilityId: "filesystem.apply_patch",
      payload: {
        path: "src/app/page.tsx",
        expectedRevision,
        patch: [
          "*** Begin Patch",
          "*** Update File: src/app/page.tsx",
          "@@",
          "-export default function OldPage() {",
          "-  return null;",
          "+export default function Page() {",
          "+  return <main>Hello</main>;",
          " }",
          "*** End Patch"
        ].join("\n")
      },
      context: {
        workspaceRoot
      }
    });
    await Promise.resolve();
    const approvalId = publishEvent.mock.calls
      .map(([event]) => event as { phase?: string; payload?: { approvalId?: string } })
      .find((event) => event.phase === "approval_requested")
      ?.payload?.approvalId;
    expect(approvalId).toBeTypeOf("string");
    await registry.resolveApproval({
      approvalId: approvalId ?? "",
      decision: "approved_once"
    });
    const result = await pendingResult;

    expect(result.ok).toBe(true);
    expect(result.result).toEqual(
      expect.objectContaining({
        ok: true,
        path: targetFile,
        addedLines: 2,
        removedLines: 2,
        patchSummary: "Applied 1 hunk (+2 -2)",
        draftPreview: expect.stringContaining("export default function Page()"),
        baselineContent: "export default function OldPage() {\n  return null;\n}\n",
        firstChangedLine: 1
      })
    );
    expect(fs.readFileSync(targetFile, "utf8")).toContain("return <main>Hello</main>;");
  });

  test("apply_patch returns structured conflicts and rejects paths outside the workspace", async () => {
    const storageRoot = createTempRoot();
    const workspaceRoot = createTempRoot();
    const targetFile = path.join(workspaceRoot, "src", "page.tsx");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "export const value = 1;\n", "utf8");

    const publishEvent = vi.fn();
    const registry = createRegistry(createFakeBindings(), storageRoot, publishEvent);

    const invalidPatchPending = registry.invoke({
      capabilityId: "filesystem.apply_patch",
      payload: {
        path: "src/page.tsx",
        patch: [
          "*** Begin Patch",
          "*** Update File: src/page.tsx",
          "@@",
          "-export const missing = 2;",
          "+export const value = 2;",
          "*** End Patch"
        ].join("\n")
      },
      context: {
        workspaceRoot
      }
    });
    await expect(invalidPatchPending).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "patch-conflict",
        message: expect.stringContaining("patch hunk does not match")
      })
    });
    expect(
      publishEvent.mock.calls.some(
        ([event]) => (event as { phase?: string }).phase === "approval_requested"
      )
    ).toBe(false);

    const outsideWorkspacePending = registry.invoke({
      capabilityId: "filesystem.apply_patch",
      payload: {
        path: "../outside.ts",
        patch: [
          "*** Begin Patch",
          "*** Update File: ../outside.ts",
          "@@",
          "-a",
          "+b",
          "*** End Patch"
        ].join("\n")
      },
      context: {
        workspaceRoot
      }
    });
    await expect(outsideWorkspacePending).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "CAPABILITY_INVOKE_FAILED",
        message: expect.stringContaining("path must stay within the active workspace root")
      })
    });
  });
});
